import path from "path"

import { type DomiaType } from "@/modules/core"
import { STT_ERRORS, sttEngineLogger, domiaError } from "@/utils"
import { type SelectSttConfigType } from "@/db"
import type { PoolJobTimingCbType } from "@/modules/inference-pool"
import { getSttPool } from "./pool"
import type {
	SttWorkerEngineConfigType,
	SttWorkerResultType,
	SttStreamSessionType,
} from "../types"

const STT_SAMPLE_RATE = 16000

const requireSttConfig = (domia: DomiaType): SelectSttConfigType => {
	const sttConfig = domia?.sttConfig
	if (!sttConfig || !sttConfig.modelPath) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: "STT requires sttConfig.modelPath (model directory)",
				modelPath: sttConfig?.modelPath,
			},
		})
	}
	return sttConfig
}

const engineConfigOf = (
	sttConfig: SelectSttConfigType,
): SttWorkerEngineConfigType => ({
	engine: sttConfig.engine,
	modelPath: path.resolve(sttConfig.modelPath),
	modelName: sttConfig.modelName ?? null,
	quantization: sttConfig.quantization ?? null,
	numThreads: sttConfig.numThreads,
	provider: sttConfig.provider,
	decodePaddingMs: sttConfig.decodePaddingMs,
	enableEndpoint: sttConfig.enableEndpoint,
	rule1MinTrailingSilence: sttConfig.rule1MinTrailingSilence,
	rule2MinTrailingSilence: sttConfig.rule2MinTrailingSilence,
	rule3MinUtteranceLength: sttConfig.rule3MinUtteranceLength,
})

export const runSttPooled = async (
	domia: DomiaType,
	filePath: string,
	onTiming?: PoolJobTimingCbType,
): Promise<string> => {
	const sttConfig = requireSttConfig(domia)
	const pool = getSttPool(sttConfig)
	const result = await pool.submit<SttWorkerResultType>(
		{
			kind: "file",
			engineConfig: engineConfigOf(sttConfig),
			wavPath: filePath,
		},
		onTiming,
	)
	return result.text
}

export const createSttSessionPooled = (
	domia: DomiaType,
): SttStreamSessionType => {
	const sttConfig = requireSttConfig(domia)
	const pool = getSttPool(sttConfig)
	const session = pool.acquireSession()
	let lastPartial = ""
	let closed = false
	let started = false
	let order: Promise<unknown> = Promise.resolve()

	const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
		const next = order.then(fn, fn)
		order = next.catch(() => undefined)
		return next
	}

	const startIfNeeded = async (): Promise<void> => {
		if (started) return
		started = true
		await session.exchange({
			kind: "session-start",
			engineConfig: engineConfigOf(sttConfig),
		})
	}

	const sendChunk = async (pcm: Buffer): Promise<string> => {
		await startIfNeeded()
		const r = await session.exchange<{ partial: string }>({
			kind: "session-chunk",
			pcm,
			sampleRate: STT_SAMPLE_RATE,
		})
		if (r?.partial !== undefined) lastPartial = r.partial
		return lastPartial
	}

	return {
		pushChunk: (pcm: Buffer) => {
			if (closed || pcm.length === 0) return
			void enqueue(() => sendChunk(pcm)).catch((err) =>
				sttEngineLogger.warn("stt session chunk failed", { err }),
			)
		},
		partial: () => lastPartial,
		flushPartial: (padMs: number) => {
			if (closed) return Promise.resolve(lastPartial)
			const pad = Buffer.alloc(Math.round((STT_SAMPLE_RATE * padMs) / 1000) * 2)
			return enqueue(() => sendChunk(pad)).catch((err) => {
				sttEngineLogger.warn("stt session flush failed", { err })
				return lastPartial
			})
		},
		finish: async () => {
			if (closed) return lastPartial
			closed = true
			try {
				return await enqueue(async () => {
					await startIfNeeded()
					const r = await session.exchange<{ text: string }>({
						kind: "session-end",
						sampleRate: STT_SAMPLE_RATE,
						decodePaddingMs: sttConfig.decodePaddingMs,
					})
					return r.text
				})
			} catch (err) {
				sttEngineLogger.warn("stt session finish failed", { err })
				return lastPartial
			} finally {
				session.release()
			}
		},
		reset: (pcm?: Buffer) => {
			if (closed) return
			void enqueue(async () => {
				await session.exchange({ kind: "session-abort" })
				started = false
				lastPartial = ""
				if (pcm && pcm.length > 0) await sendChunk(pcm)
			}).catch((err) =>
				sttEngineLogger.warn("stt session reset failed", { err }),
			)
		},
		abort: () => {
			if (closed) return
			closed = true
			void enqueue(() => session.exchange({ kind: "session-abort" }))
				.catch(() => undefined)
				.finally(() => session.release())
		},
	}
}

export const runSttPcmPooled = async (
	domia: DomiaType,
	pcm: Buffer,
	onTiming?: PoolJobTimingCbType,
): Promise<string> => {
	if (pcm.length === 0) return ""
	const sttConfig = requireSttConfig(domia)
	const pool = getSttPool(sttConfig)
	const result = await pool.submit<SttWorkerResultType>(
		{
			kind: "pcm",
			engineConfig: engineConfigOf(sttConfig),
			pcm,
			sampleRate: STT_SAMPLE_RATE,
		},
		onTiming,
	)
	return result.text
}

export const collectStreamAndTranscribePooled = async (
	domia: DomiaType,
	audioStream: AsyncIterable<Buffer>,
): Promise<string> => {
	const sttConfig = requireSttConfig(domia)
	const pool = getSttPool(sttConfig)
	const chunks: Buffer[] = []
	for await (const chunk of audioStream) {
		if (chunk.length > 0) chunks.push(Buffer.from(chunk))
	}
	const pcm = Buffer.concat(chunks)
	if (pcm.length === 0) return ""
	const result = await pool.submit<SttWorkerResultType>({
		kind: "pcm",
		engineConfig: engineConfigOf(sttConfig),
		pcm,
		sampleRate: STT_SAMPLE_RATE,
	})
	return result.text
}

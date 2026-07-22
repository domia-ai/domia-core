import { mkdir, writeFile } from "fs/promises"
import path from "path"

import { DomiaType } from "@/modules/core"
import {
	generateUuid,
	ttsEngineLogger,
	TTS_ERRORS,
	domiaError,
	wrapPcmToWav,
	applyEdgeFade,
} from "@/utils"
import {
	type SelectTtsConfigType,
	TTS_ENGINE_ENUM,
	DEFAULT_POCKET_MODEL_PATH,
	DEFAULT_POCKET_NUM_STEPS,
	DEFAULT_POCKET_VOICE_CACHE,
} from "@/db"
import { splitTextIntoSentences } from "@/modules/core-bus/utils/sentence-buffer"

import { resolveTtsVoice, getTtsPool } from "../../utils"
import { POCKET_SAMPLE_RATE } from "./inference"
import type {
	RunTtsOptionsType,
	RunTtsResultType,
	TtsEngineAdapterType,
	TtsWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

const requireTtsConfig = (domia: DomiaType): SelectTtsConfigType => {
	const ttsConfig = domia.ttsConfig
	if (!ttsConfig)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "Pocket requires a ttsConfig" },
		})
	return ttsConfig
}

const jobOf = (
	ttsConfig: SelectTtsConfigType,
	text: string,
	speed: number,
): TtsWorkerJobType => ({
	engine: TTS_ENGINE_ENUM.POCKET,
	engineConfig: {
		modelPath: path.resolve(ttsConfig.modelPath || DEFAULT_POCKET_MODEL_PATH),
		numThreads: ttsConfig.numThreads,
		provider: ttsConfig.provider,
		maxNumSentences: ttsConfig.maxNumSentences,
		referenceAudioPath: ttsConfig.engineConfig?.referenceAudioPath?.trim()
			? path.resolve(ttsConfig.engineConfig.referenceAudioPath.trim())
			: null,
		numSteps: ttsConfig.engineConfig?.numSteps ?? DEFAULT_POCKET_NUM_STEPS,
		voiceEmbeddingCacheCapacity:
			ttsConfig.engineConfig?.voiceEmbeddingCacheCapacity ??
			DEFAULT_POCKET_VOICE_CACHE,
	},
	text,
	speed,
})

const runPocket = async (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): Promise<RunTtsResultType> => {
	const ttsConfig = requireTtsConfig(domia)
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	try {
		const pool = getTtsPool(ttsConfig)
		const parts: Buffer[] = []
		for (const sentence of splitTextIntoSentences(text)) {
			const result = await pool.submit<TtsWorkerResultType>(
				jobOf(ttsConfig, sentence, voice.speed),
			)
			if (result.pcm && result.pcm.length > 0)
				parts.push(applyEdgeFade(result.pcm, POCKET_SAMPLE_RATE))
		}
		const pcm = Buffer.concat(parts)
		const outputDir = path.resolve("tmp/tts-output")
		await mkdir(outputDir, { recursive: true })
		const filePath = path.join(outputDir, `domia-${generateUuid()}.wav`)
		await writeFile(filePath, wrapPcmToWav(pcm, POCKET_SAMPLE_RATE, 1, 16))
		return {
			engineUsed: TTS_ENGINE_ENUM.POCKET,
			voiceUsed: voice.voiceName,
			format: "wav",
			filePath,
			metadata: {
				text,
				sampleRate: POCKET_SAMPLE_RATE,
				samples: pcm.length / 2,
			},
		}
	} catch (error) {
		throw domiaError(TTS_ERRORS.TTS_FAILURE, {
			logger: ttsEngineLogger,
			meta: {
				message: error instanceof Error ? error.message : String(error),
				engine: TTS_ENGINE_ENUM.POCKET,
			},
		})
	}
}

const streamSentenceChunks = (
	pool: ReturnType<typeof getTtsPool>,
	job: TtsWorkerJobType,
): AsyncIterable<Buffer> => {
	const chunks: Buffer[] = []
	let notify: (() => void) | null = null
	let done = false
	let failure: unknown = null
	const wake = (): void => {
		notify?.()
		notify = null
	}
	void pool
		.submit<TtsWorkerResultType>(
			{ ...job, stream: true },
			undefined,
			(chunk) => {
				if (Buffer.isBuffer(chunk) && chunk.length > 0) chunks.push(chunk)
				wake()
			},
		)
		.then(
			() => {
				done = true
				wake()
			},
			(err: unknown) => {
				failure = err
				done = true
				wake()
			},
		)
	return {
		[Symbol.asyncIterator]: async function* () {
			for (;;) {
				const chunk = chunks.shift()
				if (chunk) {
					yield chunk
					continue
				}
				if (done) break
				await new Promise<void>((resolve) => {
					notify = resolve
				})
			}
			if (failure) throw failure
		},
	}
}

const runPocketStream = async function* (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const ttsConfig = requireTtsConfig(domia)
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	const pool = getTtsPool(ttsConfig)
	// chunkStreaming requires the patched sherpa addon — stock generateAsync callbacks abort the worker
	const chunked = ttsConfig.engineConfig?.chunkStreaming === true
	for (const sentence of splitTextIntoSentences(text)) {
		if (!chunked) {
			const result = await pool.submit<TtsWorkerResultType>(
				jobOf(ttsConfig, sentence, voice.speed),
			)
			if (result.pcm && result.pcm.length > 0)
				yield applyEdgeFade(result.pcm, POCKET_SAMPLE_RATE)
			continue
		}
		yield* streamSentenceChunks(pool, jobOf(ttsConfig, sentence, voice.speed))
	}
}

export const pocketEngine: TtsEngineAdapterType = {
	id: TTS_ENGINE_ENUM.POCKET,
	capabilities: {
		streaming: true,
		sampleRate: POCKET_SAMPLE_RATE,
		sampleFormat: "PCM_S16LE",
		channels: 1,
		languages: ["en"],
	},
	run: runPocket,
	runStream: runPocketStream,
}

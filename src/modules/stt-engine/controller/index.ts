import { type DomiaType } from "@/modules/core"
import { STT_ENGINE_ENUM_VALUES, DEFAULT_PCM_SAMPLE_RATE } from "@/db"
import {
	STT_ERRORS,
	sttEngineLogger,
	domiaError,
	withTimeout,
	toError,
} from "@/utils"
import type { PoolJobTimingCbType } from "@/modules/inference-pool"
import { sttEngines, getSttEngine } from "../engines"
import {
	createSttPool,
	runSttPcmPooled,
	swapSttPool,
	shutdownSttPool,
} from "../utils"

const STT_PROBE_TIMEOUT_MS = 30_000
const STT_EXTERNAL_PROBE_TIMEOUT_MS = 5_000
const STT_PROBE_SILENCE = Buffer.alloc(DEFAULT_PCM_SAMPLE_RATE * 2)

export const runSTT = async (
	domia: DomiaType,
	filePath: string,
	onTiming?: PoolJobTimingCbType,
) => {
	const sttConfig = domia.sttConfig
	const engine = sttConfig?.engine

	if (!engine || !STT_ENGINE_ENUM_VALUES.includes(engine)) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				engine,
			},
		})
	}

	const handler = sttEngines[engine]

	return await handler(domia, filePath, onTiming)
}

const probeExternalStt = async (domia: DomiaType): Promise<void> => {
	const sttConfig = domia.sttConfig
	const baseUrl = sttConfig?.baseUrl?.trim()
	if (!baseUrl)
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: `${sttConfig?.engine ?? "external"} STT requires sttConfig.baseUrl`,
				engine: sttConfig?.engine,
			},
		})
	const headers: Record<string, string> = {}
	if (sttConfig?.apiKey?.trim())
		headers.authorization = `Bearer ${sttConfig.apiKey.trim()}`
	const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
		headers,
		signal: AbortSignal.timeout(STT_EXTERNAL_PROBE_TIMEOUT_MS),
	}).catch((err: unknown) => {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: toError(err).message,
				baseUrl,
				engine: sttConfig?.engine,
			},
		})
	})
	if (!res.ok)
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: { status: res.status, baseUrl, engine: sttConfig?.engine },
		})
}

export const reloadSttPool = async (domia: DomiaType): Promise<void> => {
	const sttConfig = domia.sttConfig
	if (!sttConfig) {
		await shutdownSttPool()
		return
	}
	if (getSttEngine(sttConfig.engine)?.capabilities.external === true) {
		await probeExternalStt(domia)
		await shutdownSttPool()
		return
	}
	const candidate = createSttPool(sttConfig)
	try {
		await withTimeout(
			runSttPcmPooled(domia, STT_PROBE_SILENCE, undefined, candidate),
			STT_PROBE_TIMEOUT_MS,
			"stt reload probe",
		)
	} catch (err) {
		await candidate.shutdown().catch((shutdownErr: unknown) =>
			sttEngineLogger.warn("stt candidate pool shutdown failed", {
				err: shutdownErr,
			}),
		)
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: toError(err).message,
				engine: sttConfig.engine,
				modelPath: sttConfig.modelPath,
			},
		})
	}
	await swapSttPool(candidate)
}

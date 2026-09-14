import { rm } from "fs/promises"

import { TTS_ENGINE_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import {
	domiaError,
	TTS_ERRORS,
	ttsEngineLogger,
	withTimeout,
	toError,
} from "@/utils"

import { ttsEngines } from "../engines"
import {
	sanitizeForSpeech,
	cacheablePhrasesFor,
	createTtsPool,
	swapTtsPool,
	shutdownTtsPools,
} from "../utils"
import type { RunTtsOptionsType } from "../types"

const TTS_PROBE_TIMEOUT_MS = 30_000

export const runTTS = async (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
) => {
	const ttsModelConfig = domia.ttsConfig
	const engine = ttsModelConfig?.engine

	if (!engine || !TTS_ENGINE_ENUM_VALUES.includes(engine)) {
		throw domiaError(TTS_ERRORS.TTS_ENGINE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				engine,
			},
		})
	}

	const handler = ttsEngines[engine]

	const speech = sanitizeForSpeech(text)
	if (!speech) {
		throw domiaError(TTS_ERRORS.EMPTY_TEXT, {
			logger: ttsEngineLogger,
			meta: { domiaId: domia.id, engine },
		})
	}
	return await handler(domia, speech, options)
}

const probePhrase = (domia: DomiaType): string =>
	cacheablePhrasesFor(domia.characterProfile?.language)
		.slice()
		.sort((a, b) => a.length - b.length)[0]

export const reloadTtsPool = async (domia: DomiaType): Promise<void> => {
	const ttsConfig = domia.ttsConfig
	if (!ttsConfig) {
		await shutdownTtsPools()
		return
	}
	const candidate = createTtsPool(ttsConfig)
	try {
		const { filePath } = await withTimeout(
			runTTS(domia, probePhrase(domia), { pool: candidate }),
			TTS_PROBE_TIMEOUT_MS,
			"tts reload probe",
		)
		if (filePath) await rm(filePath, { force: true }).catch(() => undefined)
	} catch (err) {
		await candidate.shutdown().catch((shutdownErr: unknown) =>
			ttsEngineLogger.warn("tts candidate pool shutdown failed", {
				err: shutdownErr,
			}),
		)
		throw domiaError(TTS_ERRORS.TTS_FAILURE, {
			logger: ttsEngineLogger,
			meta: {
				message: toError(err).message,
				engine: ttsConfig.engine,
				modelPath: ttsConfig.modelPath,
			},
		})
	}
	await swapTtsPool(ttsConfig.engine, candidate)
}

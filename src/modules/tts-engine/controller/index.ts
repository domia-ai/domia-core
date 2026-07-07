import { TTS_ENGINE_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import { domiaError, TTS_ERRORS, ttsEngineLogger } from "@/utils"

import { ttsEngines } from "../engines"
import { sanitizeForSpeech } from "../utils"
import type { RunTtsOptionsType } from "../types"

export const runTTS = async (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
) => {
	const ttsModelConfig = domia?.ttsConfig
	const engine = ttsModelConfig?.engine

	if (!engine || !TTS_ENGINE_ENUM_VALUES?.includes(engine)) {
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
		throw new Error("runTTS: empty text after sanitize — nothing to speak")
	}
	return await handler(domia, speech, options)
}

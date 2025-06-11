import { TTS_ENGINE_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import { domiaError, LLM_ERRORS, ttsEngineLogger } from "@/utils"

import { ttsEngines } from "../engines"

export const runTTS = async (domia: DomiaType, text: string) => {
	const ttsModelConfig = domia?.ttsConfig
	const engine = ttsModelConfig?.engine

	if (!engine || !TTS_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				engine,
			},
		})
	}

	const handler = ttsEngines[engine]

	return await handler(domia, text)
}

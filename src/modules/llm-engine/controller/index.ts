import { LLM_ENGINE_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import { domiaError, LLM_ERRORS, llmEngineLogger } from "@/utils"

import { llmEngines } from "../engines"

export const runLLM = async (domia: DomiaType, promptContext: string) => {
	const llmModelConfig = domia?.llmModelConfig
	const engine = llmModelConfig?.engine

	if (!engine || !LLM_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: {
				engine,
			},
		})
	}

	const handler = llmEngines[engine]

	return await handler(domia, promptContext)
}

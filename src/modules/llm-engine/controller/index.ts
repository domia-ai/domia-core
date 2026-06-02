import { LLM_ENGINE_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import { domiaError, LLM_ERRORS, llmEngineLogger } from "@/utils"

import { llmEngines, getLlmEngine } from "../engines"

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

export const runLLMJson = async (domia: DomiaType, promptContext: string) => {
	const engine = domia?.llmModelConfig?.engine

	if (!engine || !LLM_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { engine },
		})
	}

	const adapter = getLlmEngine(engine)
	const handler = adapter?.runJson ?? adapter?.run
	if (!handler) {
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { engine, reason: "no json/run handler" },
		})
	}

	return await handler(domia, promptContext)
}

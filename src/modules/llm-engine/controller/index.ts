import { LLM_ENGINE_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import { domiaError, LLM_ERRORS, llmEngineLogger } from "@/utils"

import { llmEngines, getLlmEngine } from "../engines"
import type {
	ChatMessageType,
	ToolCallOrReplyType,
	StreamReplyOrToolsType,
	ToolDefinitionType,
} from "../types"

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

export const warmupLLM = async (domia: DomiaType): Promise<void> => {
	const engine = domia?.llmModelConfig?.engine
	if (!engine || !LLM_ENGINE_ENUM_VALUES?.includes(engine)) return
	await getLlmEngine(engine)?.warmup?.(domia)
}

export const runLLMJson = async (
	domia: DomiaType,
	promptContext: string,
	shouldAbort?: () => boolean,
) => {
	const engine = domia?.llmModelConfig?.engine

	if (!engine || !LLM_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { engine },
		})
	}

	const adapter = getLlmEngine(engine)
	if (adapter?.runJson) {
		return await adapter.runJson(domia, promptContext, shouldAbort)
	}
	if (adapter?.run) {
		return await adapter.run(domia, promptContext)
	}
	throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
		logger: llmEngineLogger,
		meta: { engine, reason: "no json/run handler" },
	})
}

export const runLLMWithTools = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
): Promise<ToolCallOrReplyType> => {
	const engine = domia?.llmModelConfig?.engine

	if (!engine || !LLM_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { engine },
		})
	}

	const adapter = getLlmEngine(engine)
	if (!adapter?.runWithTools) {
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { engine, reason: "no tool-calling handler" },
		})
	}
	return await adapter.runWithTools(domia, messages, tools)
}

export const runLLMReplyStreamOrTools = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
): Promise<StreamReplyOrToolsType> => {
	const engine = domia?.llmModelConfig?.engine

	if (!engine || !LLM_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { engine },
		})
	}

	const adapter = getLlmEngine(engine)
	if (!adapter?.runReplyStreamOrTools) {
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { engine, reason: "no streaming tool-calling handler" },
		})
	}
	return await adapter.runReplyStreamOrTools(domia, messages, tools)
}

export const runLLMIntent = async (
	domia: DomiaType,
	prompt: string,
	modelName: string,
): Promise<string | null> => {
	const engine = domia?.llmModelConfig?.engine
	if (!engine || !LLM_ENGINE_ENUM_VALUES?.includes(engine)) return null
	const adapter = getLlmEngine(engine)
	if (!adapter?.runIntent) return null
	return await adapter.runIntent(domia, prompt, modelName)
}

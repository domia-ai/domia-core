import { LLM_ENGINE_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import { domiaError, LLM_ERRORS, llmEngineLogger } from "@/utils"

import { llmEngines, getLlmEngine } from "../engines"
import type {
	ChatMessageType,
	ToolCallOrReplyType,
	ToolChoiceType,
	StreamReplyOrToolsType,
	ToolDefinitionType,
	LlmUsageSinkType,
} from "../types"

export const runLLM = async (
	domia: DomiaType,
	promptContext: string,
	onUsage?: LlmUsageSinkType,
) => {
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

	return await handler(domia, promptContext, onUsage)
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
	onUsage?: LlmUsageSinkType,
	toolChoice?: ToolChoiceType,
	signal?: AbortSignal,
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
	return await adapter.runWithTools(
		domia,
		messages,
		tools,
		onUsage,
		toolChoice,
		signal,
	)
}

export const runLLMReplyStreamOrTools = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
	onUsage?: LlmUsageSinkType,
	toolChoice?: ToolChoiceType,
	signal?: AbortSignal,
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
	return await adapter.runReplyStreamOrTools(
		domia,
		messages,
		tools,
		onUsage,
		toolChoice,
		signal,
	)
}

export const runLLMConstrainedJson = async (
	domia: DomiaType,
	prompt: string,
	schema: Record<string, unknown>,
): Promise<string | null> => {
	const engine = domia?.llmModelConfig?.engine
	if (!engine || !LLM_ENGINE_ENUM_VALUES?.includes(engine)) return null
	const adapter = getLlmEngine(engine)
	if (!adapter?.runConstrainedJson) return null
	return await adapter.runConstrainedJson(domia, prompt, schema)
}

export const runLLMChatConstrainedJson = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	schema: Record<string, unknown>,
	onUsage?: LlmUsageSinkType,
	signal?: AbortSignal,
): Promise<string | null> => {
	const engine = domia?.llmModelConfig?.engine
	if (!engine || !LLM_ENGINE_ENUM_VALUES?.includes(engine)) return null
	const adapter = getLlmEngine(engine)
	if (!adapter?.runChatConstrainedJson) return null
	return await adapter.runChatConstrainedJson(
		domia,
		messages,
		schema,
		onUsage,
		signal,
	)
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

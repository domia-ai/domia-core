import { type LlmEngineEnumType, LLM_ENGINE_ENUM } from "@/db"

import { ollamaEngine } from "./ollama"
import { openAiCompatibleEngine } from "./openai-compatible"
import type { LlmEngineAdapterType } from "../types"

export const llmEngineRegistry: Record<
	LlmEngineEnumType,
	LlmEngineAdapterType
> = {
	[LLM_ENGINE_ENUM.OLLAMA]: ollamaEngine,
	[LLM_ENGINE_ENUM.OPENAI_COMPATIBLE]: openAiCompatibleEngine,
}

export const getLlmEngine = (
	id: LlmEngineEnumType,
): LlmEngineAdapterType | null => llmEngineRegistry[id] ?? null

export const llmEngines = {
	[LLM_ENGINE_ENUM.OLLAMA]: ollamaEngine.run,
	[LLM_ENGINE_ENUM.OPENAI_COMPATIBLE]: openAiCompatibleEngine.run,
}

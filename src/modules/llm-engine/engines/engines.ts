import { type LlmEngineEnumType, LLM_ENGINE_ENUM } from "@/db"

import { ollamaEngine, clearOllamaClients } from "./ollama"
import { openAiCompatibleEngine, clearOpenAiClients } from "./openai-compatible"
import type { LlmEngineAdapterType } from "../types"

export const clearLlmClientCache = (): void => {
	clearOllamaClients()
	clearOpenAiClients()
}

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

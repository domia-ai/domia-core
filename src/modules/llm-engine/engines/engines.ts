import { DomiaType } from "@/modules/core"
import { type LlmEngineEnumType, LLM_ENGINE_ENUM } from "@/db"

import { runOllama } from "./ollama"
import { runLlamaCpp } from "./llamaCpp"

export const llmEngines: Record<
	LlmEngineEnumType,
	(domia: DomiaType, promptContext: string) => Promise<string>
> = {
	[LLM_ENGINE_ENUM.OLLAMA]: runOllama,
	[LLM_ENGINE_ENUM.LLAMA_CPP]: runLlamaCpp,
}

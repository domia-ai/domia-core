import { DomiaType } from "@/modules/core"
import { LLM_ENGINE_ENUM } from "@/db"
import type { LlmEngineAdapterType } from "../../types"

export const runLlamaCpp = async (domia: DomiaType, promptContext: string) => {
	return `${domia?.name} ${promptContext}`
}

export const llamaCppEngine: LlmEngineAdapterType = {
	id: LLM_ENGINE_ENUM.LLAMA_CPP,
	capabilities: { streaming: false },
	run: runLlamaCpp,
}

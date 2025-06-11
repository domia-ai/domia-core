import { Ollama } from "ollama"

import { DomiaType } from "@/modules/core"
import { llmEngineLogger } from "@/utils"
import { LLM_ERRORS, domiaError } from "@/utils"

const client = new Ollama({ host: "http://localhost:11434" })

export const runOllama = async (
	domia: DomiaType,
	promptContext: string,
): Promise<string> => {
	const modelName = domia.llmModelConfig?.modelName

	if (!modelName) {
		throw domiaError(LLM_ERRORS.MODEL_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { domiaId: domia.id },
		})
	}

	try {
		const response = await client.generate({
			model: modelName,
			prompt: promptContext,
			stream: false,
		})

		return response.response?.trim() || ""
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	}
}

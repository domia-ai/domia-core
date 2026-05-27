import { Ollama } from "ollama"

import { env } from "@/config"
import { DomiaType } from "@/modules/core"
import { llmEngineLogger } from "@/utils"
import { LLM_ERRORS, domiaError } from "@/utils"
import { LLM_ENGINE_ENUM } from "@/db"
import type { LlmEngineAdapterType } from "../../types"

const client = new Ollama({ host: env.OLLAMA_HOST })

const KEEP_ALIVE = -1

const requireModel = (domia: DomiaType): string => {
	const modelName = domia.llmModelConfig?.modelName
	if (!modelName) {
		throw domiaError(LLM_ERRORS.MODEL_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { domiaId: domia.id },
		})
	}
	return modelName
}

export const runOllama = async (
	domia: DomiaType,
	promptContext: string,
): Promise<string> => {
	const modelName = requireModel(domia)
	try {
		const response = await client.generate({
			model: modelName,
			prompt: promptContext,
			stream: false,
			keep_alive: KEEP_ALIVE,
		})
		return response.response?.trim() || ""
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	}
}

const runOllamaStream = async function* (
	domia: DomiaType,
	promptContext: string,
): AsyncIterable<string> {
	const modelName = requireModel(domia)
	try {
		const response = await client.generate({
			model: modelName,
			prompt: promptContext,
			stream: true,
			keep_alive: KEEP_ALIVE,
		})
		for await (const chunk of response) {
			if (chunk.response) yield chunk.response
		}
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	}
}

export const ollamaEngine: LlmEngineAdapterType = {
	id: LLM_ENGINE_ENUM.OLLAMA,
	capabilities: { streaming: true },
	run: runOllama,
	runStream: runOllamaStream,
}

import { Ollama } from "ollama"

import { env } from "@/config"
import { DomiaType } from "@/modules/core"
import { llmEngineLogger, createAsyncSemaphore } from "@/utils"
import { LLM_ERRORS, domiaError } from "@/utils"
import { LLM_ENGINE_ENUM, DEFAULT_LLM_CONCURRENCY } from "@/db"
import type { LlmEngineAdapterType } from "../../types"

const client = new Ollama({ host: env.OLLAMA_HOST })

const KEEP_ALIVE = -1
const JSON_NUM_PREDICT = 512

const llmSemaphore = createAsyncSemaphore(1)

const acquireSlot = (domia: DomiaType): Promise<() => void> => {
	llmSemaphore.setLimit(
		domia?.llmModelConfig?.llmConcurrency ?? DEFAULT_LLM_CONCURRENCY,
	)
	return llmSemaphore.acquire()
}

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

const resolveOptions = (domia: DomiaType) => {
	const config = domia.llmModelConfig
	return {
		temperature: config?.temperature,
		num_ctx: config?.contextWindow,
		num_predict: config?.numPredict,
	}
}

export const runOllama = async (
	domia: DomiaType,
	promptContext: string,
): Promise<string> => {
	const modelName = requireModel(domia)
	const release = await acquireSlot(domia)
	try {
		const response = await client.generate({
			model: modelName,
			prompt: promptContext,
			stream: false,
			keep_alive: KEEP_ALIVE,
			options: resolveOptions(domia),
		})
		return response.response?.trim() || ""
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		release()
	}
}

const runOllamaStream = async function* (
	domia: DomiaType,
	promptContext: string,
): AsyncIterable<string> {
	const modelName = requireModel(domia)
	const release = await acquireSlot(domia)
	try {
		const response = await client.generate({
			model: modelName,
			prompt: promptContext,
			stream: true,
			keep_alive: KEEP_ALIVE,
			options: resolveOptions(domia),
		})
		for await (const chunk of response) {
			if (chunk.response) yield chunk.response
		}
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		release()
	}
}

const runOllamaJson = async (
	domia: DomiaType,
	promptContext: string,
): Promise<string> => {
	const modelName = requireModel(domia)
	const release = await acquireSlot(domia)
	try {
		const response = await client.generate({
			model: modelName,
			prompt: promptContext,
			stream: false,
			keep_alive: KEEP_ALIVE,
			format: "json",
			options: { ...resolveOptions(domia), num_predict: JSON_NUM_PREDICT },
		})
		return response.response?.trim() || ""
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		release()
	}
}

export const ollamaEngine: LlmEngineAdapterType = {
	id: LLM_ENGINE_ENUM.OLLAMA,
	capabilities: { streaming: true },
	run: runOllama,
	runStream: runOllamaStream,
	runJson: runOllamaJson,
}

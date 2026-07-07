import { Ollama, type Message, type Tool } from "ollama"

import { DomiaType } from "@/modules/core"
import { llmEngineLogger, createAsyncSemaphore, parseLlmJson } from "@/utils"
import { LLM_ERRORS, domiaError } from "@/utils"
import {
	LLM_ENGINE_ENUM,
	DEFAULT_LLM_CONCURRENCY,
	DEFAULT_OLLAMA_HOST,
	DEFAULT_OLLAMA_KEEP_ALIVE_MS,
} from "@/db"
import type {
	ChatMessageType,
	LlmEngineAdapterType,
	ToolCallType,
	ToolCallOrReplyType,
	StreamReplyOrToolsType,
	ToolDefinitionType,
	LlmUsageType,
	LlmUsageSinkType,
} from "../../types"
import type { OllamaStatsType } from "./types"

const ollamaUsage = (
	r: OllamaStatsType,
	contextWindow?: number,
): LlmUsageType => ({
	promptTokens: r.prompt_eval_count ?? null,
	completionTokens: r.eval_count ?? null,
	tokensPerSec:
		r.eval_count && r.eval_duration
			? Math.round((r.eval_count / (r.eval_duration / 1e9)) * 100) / 100
			: null,
	ttftMs: r.prompt_eval_duration
		? Math.round(r.prompt_eval_duration / 1e6)
		: null,
	contextWindow: contextWindow ?? null,
	finishReason: r.done_reason ?? null,
})

const clients = new Map<string, Ollama>()

export const clearOllamaClients = (): void => clients.clear()

const getClient = (domia: DomiaType): Ollama => {
	const host = domia.llmModelConfig?.baseUrl?.trim() || DEFAULT_OLLAMA_HOST
	const existing = clients.get(host)
	if (existing) return existing
	const client = new Ollama({ host })
	clients.set(host, client)
	return client
}

const resolveKeepAlive = (domia: DomiaType): number => {
	const ms = domia.llmModelConfig?.keepAliveMs ?? DEFAULT_OLLAMA_KEEP_ALIVE_MS
	return ms < 0 ? -1 : Math.round(ms / 1000)
}

const JSON_NUM_PREDICT = 192
const TOOL_CALL_TEMPERATURE = 0.2
const TOOL_CALL_NUM_PREDICT = 512

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
	onUsage?: LlmUsageSinkType,
): Promise<string> => {
	const modelName = requireModel(domia)
	const release = await acquireSlot(domia)
	const client = getClient(domia)
	try {
		const response = await client.generate({
			model: modelName,
			prompt: promptContext,
			stream: false,
			keep_alive: resolveKeepAlive(domia),
			options: resolveOptions(domia),
		})
		onUsage?.(ollamaUsage(response, domia.llmModelConfig?.contextWindow))
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
	shouldAbort?: () => boolean,
	onUsage?: LlmUsageSinkType,
): AsyncIterable<string> {
	const modelName = requireModel(domia)
	const release = await acquireSlot(domia)
	const client = getClient(domia)
	let abortStream: (() => void) | null = null
	try {
		if (shouldAbort?.()) return
		const stream = await client.generate({
			model: modelName,
			prompt: promptContext,
			stream: true,
			keep_alive: resolveKeepAlive(domia),
			options: resolveOptions(domia),
		})
		abortStream = () => stream.abort()
		for await (const chunk of stream) {
			if (shouldAbort?.()) {
				stream.abort()
				return
			}
			if (chunk.response) yield chunk.response
			if (chunk.done && onUsage)
				onUsage(ollamaUsage(chunk, domia.llmModelConfig?.contextWindow))
		}
		abortStream = null
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		try {
			abortStream?.()
		} catch {
			/* already finished */
		}
		release()
	}
}

const runOllamaJson = async (
	domia: DomiaType,
	promptContext: string,
	shouldAbort?: () => boolean,
): Promise<string> => {
	const modelName = requireModel(domia)
	const release = await acquireSlot(domia)
	const client = getClient(domia)
	try {
		if (shouldAbort?.()) return ""
		const stream = await client.generate({
			model: modelName,
			prompt: promptContext,
			stream: true,
			keep_alive: resolveKeepAlive(domia),
			format: "json",
			options: { ...resolveOptions(domia), num_predict: JSON_NUM_PREDICT },
		})
		let out = ""
		for await (const chunk of stream) {
			if (shouldAbort?.()) {
				stream.abort()
				return ""
			}
			out += chunk.response ?? ""
		}
		return out.trim()
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		release()
	}
}

const toOllamaMessages = (messages: ChatMessageType[]): Message[] =>
	messages.map((m) => {
		const base: Record<string, unknown> = { role: m.role, content: m.content }
		if (m.toolName) base.tool_name = m.toolName
		if (m.toolCalls?.length)
			base.tool_calls = m.toolCalls.map((c) => ({
				function: { name: c.name, arguments: c.arguments },
			}))
		return base as unknown as Message
	})

const toOllamaTools = (tools: ToolDefinitionType[]): Tool[] =>
	tools.map(
		(t) =>
			({
				type: "function",
				function: {
					name: t.name,
					description: t.description ?? "",
					parameters: t.parameters,
				},
			}) as unknown as Tool,
	)

const normalizeArgs = (raw: unknown): Record<string, unknown> => {
	if (typeof raw === "string") {
		const { value } = parseLlmJson(raw)
		if (value) return value
		llmEngineLogger.warn("tool-call arguments failed to parse — using {}", {
			raw: raw.slice(0, 200),
		})
		return {}
	}
	if (raw && typeof raw === "object") return raw as Record<string, unknown>
	return {}
}

const requireToolModel = (domia: DomiaType): string =>
	domia.llmModelConfig?.toolModelName?.trim() || requireModel(domia)

const runOllamaWithTools = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
	onUsage?: LlmUsageSinkType,
): Promise<ToolCallOrReplyType> => {
	const modelName = requireToolModel(domia)
	const release = await acquireSlot(domia)
	const client = getClient(domia)
	try {
		const response = await client.chat({
			model: modelName,
			messages: toOllamaMessages(messages),
			tools: toOllamaTools(tools),
			stream: false,
			keep_alive: resolveKeepAlive(domia),
			options: {
				...resolveOptions(domia),
				temperature: TOOL_CALL_TEMPERATURE,
				num_predict: TOOL_CALL_NUM_PREDICT,
			},
		})
		onUsage?.(ollamaUsage(response, domia.llmModelConfig?.contextWindow))
		const toolCalls = response.message?.tool_calls
		if (toolCalls?.length) {
			const calls: ToolCallType[] = toolCalls.map((c) => ({
				name: c.function.name,
				arguments: normalizeArgs(c.function.arguments),
			}))
			return { kind: "tool_calls", calls }
		}
		return { kind: "reply", text: response.message?.content?.trim() || "" }
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		release()
	}
}

const runOllamaReplyStreamOrTools = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
	onUsage?: LlmUsageSinkType,
): Promise<StreamReplyOrToolsType> => {
	const modelName = requireModel(domia)
	const release = await acquireSlot(domia)
	const client = getClient(domia)
	let released = false
	const releaseOnce = () => {
		if (released) return
		released = true
		release()
	}
	try {
		const stream = await client.chat({
			model: modelName,
			messages: toOllamaMessages(messages),
			tools: toOllamaTools(tools),
			stream: true,
			keep_alive: resolveKeepAlive(domia),
			options: {
				...resolveOptions(domia),
				temperature: TOOL_CALL_TEMPERATURE,
				num_predict: TOOL_CALL_NUM_PREDICT,
			},
		})
		const iter = stream[Symbol.asyncIterator]()
		let first = await iter.next()
		while (
			!first.done &&
			!first.value.message?.tool_calls?.length &&
			!first.value.message?.content
		)
			first = await iter.next()

		if (!first.done && first.value.message?.tool_calls?.length) {
			const calls: ToolCallType[] = first.value.message.tool_calls.map((c) => ({
				name: c.function.name,
				arguments: normalizeArgs(c.function.arguments),
			}))
			let last = first.value
			while (true) {
				const next = await iter.next()
				if (next.done) break
				last = next.value
			}
			if (onUsage)
				onUsage(ollamaUsage(last, domia.llmModelConfig?.contextWindow))
			releaseOnce()
			return { kind: "tool_calls", calls }
		}

		const firstContent = first.done ? "" : (first.value.message?.content ?? "")
		const tokens = (async function* (): AsyncIterable<string> {
			try {
				if (firstContent) yield firstContent
				while (true) {
					const next = await iter.next()
					if (next.done) break
					if (next.value.message?.content) yield next.value.message.content
					if (next.value.done && onUsage)
						onUsage(
							ollamaUsage(next.value, domia.llmModelConfig?.contextWindow),
						)
				}
			} finally {
				try {
					stream.abort()
				} catch {
					/* already finished */
				}
				releaseOnce()
			}
		})()
		return { kind: "reply", tokens }
	} catch (error) {
		releaseOnce()
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	}
}

const INTENT_NUM_PREDICT = 48

const runOllamaIntent = async (
	domia: DomiaType,
	prompt: string,
	modelName: string,
): Promise<string> => {
	const release = await acquireSlot(domia)
	const client = getClient(domia)
	try {
		const response = await client.generate({
			model: modelName,
			prompt,
			stream: false,
			keep_alive: resolveKeepAlive(domia),
			format: "json",
			options: { temperature: 0, num_predict: INTENT_NUM_PREDICT },
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

const warmupModel = async (
	domia: DomiaType,
	client: Ollama,
	modelName: string,
): Promise<void> => {
	await client.generate({
		model: modelName,
		prompt: "Hi",
		stream: false,
		keep_alive: resolveKeepAlive(domia),
		options: { num_predict: 1 },
	})
}

const warmupOllama = async (domia: DomiaType): Promise<void> => {
	const client = getClient(domia)
	const main = domia.llmModelConfig?.modelName
	const reflection = domia.llmModelConfig?.reflectionModelName?.trim()
	const tool = domia.llmModelConfig?.toolModelName?.trim()
	const models = [...new Set([main, reflection || null, tool || null])].filter(
		(m): m is string => Boolean(m),
	)
	for (const model of models) {
		await warmupModel(domia, client, model)
	}
}

export const ollamaEngine: LlmEngineAdapterType = {
	id: LLM_ENGINE_ENUM.OLLAMA,
	capabilities: { streaming: true, tools: true },
	run: runOllama,
	runStream: runOllamaStream,
	runJson: runOllamaJson,
	runWithTools: runOllamaWithTools,
	runReplyStreamOrTools: runOllamaReplyStreamOrTools,
	runIntent: runOllamaIntent,
	warmup: warmupOllama,
}

import OpenAI from "openai"

import { DomiaType } from "@/modules/core"
import { llmEngineLogger, createAsyncSemaphore, parseLlmJson } from "@/utils"
import { LLM_ERRORS, domiaError } from "@/utils"
import { LLM_ENGINE_ENUM, DEFAULT_LLM_CONCURRENCY } from "@/db"
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
import type {
	OpenAiResolvedConfigType,
	LlamaTimingsType,
	ToolCallAccType,
} from "./types"

const openAiUsage = (
	usage:
		| { prompt_tokens?: number; completion_tokens?: number }
		| null
		| undefined,
	finishReason: string | null | undefined,
	timings: LlamaTimingsType | undefined,
	contextWindow?: number,
): LlmUsageType => ({
	promptTokens: usage?.prompt_tokens ?? null,
	completionTokens: usage?.completion_tokens ?? null,
	tokensPerSec:
		timings?.predicted_per_second != null
			? Math.round(timings.predicted_per_second * 100) / 100
			: null,
	ttftMs: timings?.prompt_ms != null ? Math.round(timings.prompt_ms) : null,
	contextWindow: contextWindow ?? null,
	finishReason: finishReason ?? null,
})

const timingsOf = (raw: unknown): LlamaTimingsType | undefined =>
	raw && typeof raw === "object" && "timings" in raw
		? ((raw as { timings?: LlamaTimingsType }).timings ?? undefined)
		: undefined

const JSON_NUM_PREDICT = 192
const INTENT_NUM_PREDICT = 48
const TOOL_CALL_TEMPERATURE = 0.2
const TOOL_CALL_NUM_PREDICT = 512
const NO_AUTH = "noauth"

const llmSemaphore = createAsyncSemaphore(1)
const clients = new Map<string, OpenAI>()

export const clearOpenAiClients = (): void => clients.clear()

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

const resolveConfig = (domia: DomiaType): OpenAiResolvedConfigType => {
	const config = domia.llmModelConfig
	const baseURL = config?.baseUrl?.trim()
	if (!baseURL) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: {
				domiaId: domia.id,
				reason: "openai-compatible engine requires llmModelConfig.baseUrl",
			},
		})
	}
	return {
		baseURL,
		apiKey: config?.apiKey?.trim() || NO_AUTH,
		temperature: config?.temperature,
		maxTokens: config?.numPredict,
	}
}

const getClient = (cfg: OpenAiResolvedConfigType): OpenAI => {
	const key = `${cfg.baseURL}|${cfg.apiKey}`
	const existing = clients.get(key)
	if (existing) return existing
	const client = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey })
	clients.set(key, client)
	return client
}

const userMessages = (
	prompt: string,
): OpenAI.Chat.ChatCompletionMessageParam[] => [
	{ role: "user", content: prompt },
]

const requireToolModel = (domia: DomiaType): string =>
	domia.llmModelConfig?.toolModelName?.trim() || requireModel(domia)

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

const toOpenAiMessages = (
	messages: ChatMessageType[],
): OpenAI.Chat.ChatCompletionMessageParam[] => {
	const out: OpenAI.Chat.ChatCompletionMessageParam[] = []
	const pendingIds: string[] = []
	let counter = 0
	for (const m of messages) {
		if (m.role === "assistant" && m.toolCalls?.length) {
			const toolCalls = m.toolCalls.map((c) => {
				const id = `call_${counter++}`
				pendingIds.push(id)
				return {
					id,
					type: "function" as const,
					function: {
						name: c.name,
						arguments: JSON.stringify(c.arguments ?? {}),
					},
				}
			})
			out.push({
				role: "assistant",
				content: m.content || null,
				tool_calls: toolCalls,
			})
		} else if (m.role === "tool") {
			const id = pendingIds.shift() ?? `call_${counter++}`
			out.push({ role: "tool", tool_call_id: id, content: m.content })
		} else if (m.role === "assistant") {
			out.push({ role: "assistant", content: m.content })
		} else if (m.role === "system") {
			out.push({ role: "system", content: m.content })
		} else {
			out.push({ role: "user", content: m.content })
		}
	}
	return out
}

const toOpenAiTools = (
	tools: ToolDefinitionType[],
): OpenAI.Chat.ChatCompletionTool[] =>
	tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description ?? "",
			parameters: t.parameters,
		},
	}))

export const runOpenAiCompatible = async (
	domia: DomiaType,
	promptContext: string,
	onUsage?: LlmUsageSinkType,
): Promise<string> => {
	const modelName = requireModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const release = await acquireSlot(domia)
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(promptContext),
			temperature: cfg.temperature,
			max_tokens: cfg.maxTokens,
		})
		onUsage?.(
			openAiUsage(
				response.usage,
				response.choices[0]?.finish_reason,
				timingsOf(response),
				domia.llmModelConfig?.contextWindow,
			),
		)
		return response.choices[0]?.message?.content?.trim() || ""
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		release()
	}
}

const runOpenAiCompatibleStream = async function* (
	domia: DomiaType,
	promptContext: string,
	shouldAbort?: () => boolean,
	onUsage?: LlmUsageSinkType,
): AsyncIterable<string> {
	const modelName = requireModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const release = await acquireSlot(domia)
	let abortStream: (() => void) | null = null
	let finishReason: string | null = null
	try {
		if (shouldAbort?.()) return
		const stream = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(promptContext),
			temperature: cfg.temperature,
			max_tokens: cfg.maxTokens,
			stream: true,
			...(domia.llmModelConfig?.streamUsage !== false
				? { stream_options: { include_usage: true } }
				: {}),
		})
		abortStream = () => stream.controller.abort()
		for await (const chunk of stream) {
			if (shouldAbort?.()) {
				stream.controller.abort()
				return
			}
			const token = chunk.choices[0]?.delta?.content
			if (token) yield token
			if (chunk.choices[0]?.finish_reason)
				finishReason = chunk.choices[0].finish_reason
			if (chunk.usage && onUsage)
				onUsage(
					openAiUsage(
						chunk.usage,
						finishReason,
						timingsOf(chunk),
						domia.llmModelConfig?.contextWindow,
					),
				)
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

const runOpenAiCompatibleJson = async (
	domia: DomiaType,
	promptContext: string,
	shouldAbort?: () => boolean,
): Promise<string> => {
	const modelName = requireModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const release = await acquireSlot(domia)
	try {
		if (shouldAbort?.()) return ""
		const stream = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(promptContext),
			temperature: cfg.temperature,
			max_tokens: JSON_NUM_PREDICT,
			response_format: { type: "json_object" },
			stream: true,
		})
		let out = ""
		for await (const chunk of stream) {
			if (shouldAbort?.()) {
				stream.controller.abort()
				return ""
			}
			out += chunk.choices[0]?.delta?.content ?? ""
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

const runOpenAiCompatibleIntent = async (
	domia: DomiaType,
	prompt: string,
	modelName: string,
): Promise<string> => {
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const release = await acquireSlot(domia)
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(prompt),
			temperature: 0,
			max_tokens: INTENT_NUM_PREDICT,
			response_format: { type: "json_object" },
		})
		return response.choices[0]?.message?.content?.trim() || ""
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		release()
	}
}

const warmupModel = (client: OpenAI, modelName: string): Promise<unknown> =>
	client.chat.completions.create({
		model: modelName,
		messages: userMessages("Hi"),
		max_tokens: 1,
	})

const warmupOpenAiCompatible = async (domia: DomiaType): Promise<void> => {
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const main = domia.llmModelConfig?.modelName
	const reflection = domia.llmModelConfig?.reflectionModelName?.trim()
	const tool = domia.llmModelConfig?.toolModelName?.trim()
	const models = [...new Set([main, reflection || null, tool || null])].filter(
		(m): m is string => Boolean(m),
	)
	for (const model of models) {
		await warmupModel(client, model)
	}
}

const runOpenAiCompatibleWithTools = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
	onUsage?: LlmUsageSinkType,
): Promise<ToolCallOrReplyType> => {
	const modelName = requireToolModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const release = await acquireSlot(domia)
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: toOpenAiMessages(messages),
			tools: toOpenAiTools(tools),
			temperature: TOOL_CALL_TEMPERATURE,
			max_tokens: TOOL_CALL_NUM_PREDICT,
		})
		onUsage?.(
			openAiUsage(
				response.usage,
				response.choices[0]?.finish_reason,
				timingsOf(response),
				domia.llmModelConfig?.contextWindow,
			),
		)
		const message = response.choices[0]?.message
		const toolCalls = message?.tool_calls
		if (toolCalls?.length) {
			const calls: ToolCallType[] = toolCalls
				.filter((c) => c.type === "function")
				.map((c) => ({
					name: c.function.name,
					arguments: normalizeArgs(c.function.arguments),
				}))
			return { kind: "tool_calls", calls }
		}
		return { kind: "reply", text: message?.content?.trim() || "" }
	} catch (error) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		release()
	}
}

const runOpenAiCompatibleReplyStreamOrTools = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
	onUsage?: LlmUsageSinkType,
): Promise<StreamReplyOrToolsType> => {
	const modelName = requireModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const release = await acquireSlot(domia)
	let released = false
	const releaseOnce = () => {
		if (released) return
		released = true
		release()
	}
	try {
		const stream = await client.chat.completions.create({
			model: modelName,
			messages: toOpenAiMessages(messages),
			tools: toOpenAiTools(tools),
			temperature: TOOL_CALL_TEMPERATURE,
			max_tokens: TOOL_CALL_NUM_PREDICT,
			stream: true,
			...(domia.llmModelConfig?.streamUsage !== false
				? { stream_options: { include_usage: true } }
				: {}),
		})
		const iter = stream[Symbol.asyncIterator]()
		let first = await iter.next()
		while (
			!first.done &&
			!first.value.choices[0]?.delta?.tool_calls?.length &&
			!first.value.choices[0]?.delta?.content
		)
			first = await iter.next()

		const firstDelta = first.done ? undefined : first.value.choices[0]?.delta

		if (firstDelta?.tool_calls?.length) {
			const acc = new Map<number, ToolCallAccType>()
			const apply = (
				deltas: OpenAI.Chat.ChatCompletionChunk.Choice.Delta.ToolCall[],
			) => {
				for (const tc of deltas) {
					const idx = tc.index ?? 0
					const cur = acc.get(idx) ?? { name: "", args: "" }
					if (tc.function?.name) cur.name = tc.function.name
					if (tc.function?.arguments) cur.args += tc.function.arguments
					acc.set(idx, cur)
				}
			}
			apply(firstDelta.tool_calls)
			let toolFinishReason: string | null = first.done
				? null
				: (first.value.choices[0]?.finish_reason ?? null)
			while (true) {
				const next = await iter.next()
				if (next.done) break
				const deltas = next.value.choices[0]?.delta?.tool_calls
				if (deltas?.length) apply(deltas)
				if (next.value.choices[0]?.finish_reason)
					toolFinishReason = next.value.choices[0].finish_reason
				if (next.value.usage && onUsage)
					onUsage(
						openAiUsage(
							next.value.usage,
							toolFinishReason,
							timingsOf(next.value),
							domia.llmModelConfig?.contextWindow,
						),
					)
			}
			releaseOnce()
			const calls: ToolCallType[] = [...acc.values()]
				.filter((c) => c.name)
				.map((c) => ({ name: c.name, arguments: normalizeArgs(c.args) }))
			return { kind: "tool_calls", calls }
		}

		const firstContent = firstDelta?.content ?? ""
		let finishReason: string | null = first.done
			? null
			: (first.value.choices[0]?.finish_reason ?? null)
		const tokens = (async function* (): AsyncIterable<string> {
			try {
				if (firstContent) yield firstContent
				while (true) {
					const next = await iter.next()
					if (next.done) break
					const token = next.value.choices[0]?.delta?.content
					if (token) yield token
					if (next.value.choices[0]?.finish_reason)
						finishReason = next.value.choices[0].finish_reason
					if (next.value.usage && onUsage)
						onUsage(
							openAiUsage(
								next.value.usage,
								finishReason,
								timingsOf(next.value),
								domia.llmModelConfig?.contextWindow,
							),
						)
				}
			} finally {
				try {
					stream.controller.abort()
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

export const openAiCompatibleEngine: LlmEngineAdapterType = {
	id: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
	capabilities: { streaming: true, tools: true },
	run: runOpenAiCompatible,
	runStream: runOpenAiCompatibleStream,
	runJson: runOpenAiCompatibleJson,
	runWithTools: runOpenAiCompatibleWithTools,
	runReplyStreamOrTools: runOpenAiCompatibleReplyStreamOrTools,
	runIntent: runOpenAiCompatibleIntent,
	warmup: warmupOpenAiCompatible,
}

import OpenAI from "openai"

import { DomiaType } from "@/modules/core"
import {
	acquireSlotLease,
	invalidateSlots,
	type LlmSlotPurposeType,
} from "@/modules/llm-slots"
import { llmEngineLogger, createAsyncSemaphore, parseLlmJson } from "@/utils"
import { LLM_ERRORS, domiaError } from "@/utils"
import {
	LLM_ENGINE_ENUM,
	DEFAULT_LLM_CONCURRENCY,
	DEFAULT_TOOL_CALL_TEMPERATURE,
	DEFAULT_TOOL_CALL_NUM_PREDICT,
} from "@/db"
import type {
	ChatMessageType,
	LlmEngineAdapterType,
	ToolCallType,
	ToolCallOrReplyType,
	ToolChoiceType,
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
	requestId?: string | null,
	wall?: { ttftMs: number | null; tokensPerSec: number | null },
): LlmUsageType => ({
	requestId: requestId ?? null,
	promptTokens: usage?.prompt_tokens ?? null,
	completionTokens: usage?.completion_tokens ?? null,
	tokensPerSec:
		timings?.predicted_per_second != null
			? Math.round(timings.predicted_per_second * 100) / 100
			: (wall?.tokensPerSec ?? null),
	ttftMs:
		timings?.prompt_ms != null
			? Math.round(timings.prompt_ms)
			: (wall?.ttftMs ?? null),
	contextWindow: contextWindow ?? null,
	finishReason: finishReason ?? null,
	freshTokens: timings?.prompt_n ?? null,
	cachedTokens: timings?.cache_n ?? null,
})

const wallStats = (
	startedAt: number,
	firstTokenAt: number | null,
	completionTokens: number | null | undefined,
): { ttftMs: number | null; tokensPerSec: number | null } => {
	const genMs = firstTokenAt != null ? Date.now() - firstTokenAt : 0
	return {
		ttftMs: firstTokenAt != null ? firstTokenAt - startedAt : null,
		tokensPerSec:
			firstTokenAt != null &&
			completionTokens != null &&
			completionTokens > 1 &&
			genMs > 0
				? Math.round(((completionTokens - 1) / (genMs / 1000)) * 100) / 100
				: null,
	}
}

const safeAbort = (abort: (() => void) | null): void => {
	try {
		abort?.()
	} catch {
		return
	}
}

const timingsOf = (raw: unknown): LlamaTimingsType | undefined =>
	raw && typeof raw === "object" && "timings" in raw
		? ((raw as { timings?: LlamaTimingsType }).timings ?? undefined)
		: undefined

const JSON_NUM_PREDICT = 192
const INTENT_NUM_PREDICT = 48
const NO_AUTH = "noauth"

const llmSemaphore = createAsyncSemaphore(1)
const clients = new Map<string, OpenAI>()

export const clearOpenAiClients = (): void => clients.clear()

const acquireSlot = async (
	domia: DomiaType,
	purpose: LlmSlotPurposeType = "interactive",
	label = "unlabeled",
): Promise<{ release: () => void; slotId: number | null }> => {
	llmSemaphore.setLimit(
		domia?.llmModelConfig?.llmConcurrency ?? DEFAULT_LLM_CONCURRENCY,
	)
	const releaseSemaphore = await llmSemaphore.acquire()
	let lease: { slotId: number; release: () => void } | null = null
	try {
		lease = await acquireSlotLease(domia, purpose)
	} catch (error) {
		releaseSemaphore()
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error, reason: "slot lease acquisition" },
		})
	}
	llmEngineLogger.debug("llm slot acquired", {
		label,
		purpose,
		slotId: lease?.slotId ?? null,
	})
	let released = false
	return {
		slotId: lease?.slotId ?? null,
		release: () => {
			if (released) return
			released = true
			lease?.release()
			releaseSemaphore()
		},
	}
}

const slotBody = (slotId: number | null): { id_slot?: number } =>
	slotId !== null ? { id_slot: slotId } : {}

const CONNECTION_ERROR_RE =
	/ECONNREFUSED|ECONNRESET|fetch failed|connection error|APIConnectionError|socket hang up/i

const maybeInvalidateSlots = (domia: DomiaType, error: unknown): void => {
	const err = error as Error & { cause?: Error }
	const text = `${err?.constructor?.name ?? ""} ${err?.name ?? ""} ${err?.message ?? ""} ${err?.cause?.message ?? ""}`
	if (CONNECTION_ERROR_RE.test(text)) invalidateSlots(domia)
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

const samplerBody = (domia: DomiaType): Record<string, unknown> => {
	const config = domia.llmModelConfig
	return {
		...(config?.seed != null ? { seed: config.seed } : {}),
		...(config?.stopSequences?.length ? { stop: config.stopSequences } : {}),
		...(config?.topK != null ? { top_k: config.topK } : {}),
		...(config?.minP != null ? { min_p: config.minP } : {}),
		...(config?.repeatPenalty != null
			? { repeat_penalty: config.repeatPenalty }
			: {}),
	}
}

const toolSampler = (domia: DomiaType) => ({
	temperature:
		domia.llmModelConfig?.toolTemperature ?? DEFAULT_TOOL_CALL_TEMPERATURE,
	max_tokens:
		domia.llmModelConfig?.toolNumPredict ?? DEFAULT_TOOL_CALL_NUM_PREDICT,
	...samplerBody(domia),
})

const requireToolModel = (domia: DomiaType): string =>
	domia.llmModelConfig?.toolModelName?.trim() || requireModel(domia)

const normalizeArgs = (
	raw: unknown,
): { args: Record<string, unknown>; invalid: boolean } => {
	if (typeof raw === "string") {
		const { value } = parseLlmJson(raw)
		if (value) return { args: value, invalid: false }
		llmEngineLogger.warn("tool-call arguments failed to parse", {
			raw: raw.slice(0, 200),
		})
		return { args: {}, invalid: true }
	}
	if (raw && typeof raw === "object")
		return { args: raw as Record<string, unknown>, invalid: false }
	return { args: {}, invalid: false }
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
	const lease = await acquireSlot(domia, "interactive", "run")
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(promptContext),
			temperature: cfg.temperature,
			max_tokens: cfg.maxTokens,
			...samplerBody(domia),
			...slotBody(lease.slotId),
		})
		onUsage?.(
			openAiUsage(
				response.usage,
				response.choices[0]?.finish_reason,
				timingsOf(response),
				domia.llmModelConfig?.contextWindow,
				response.id,
			),
		)
		return response.choices[0]?.message?.content?.trim() || ""
	} catch (error) {
		maybeInvalidateSlots(domia, error)
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		lease.release()
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
	const lease = await acquireSlot(domia, "interactive", "stream")
	const release = lease.release
	let abortStream: (() => void) | null = null
	let finishReason: string | null = null
	try {
		if (shouldAbort?.()) return
		const startedAt = Date.now()
		let firstTokenAt: number | null = null
		const stream = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(promptContext),
			temperature: cfg.temperature,
			max_tokens: cfg.maxTokens,
			stream: true,
			...(domia.llmModelConfig?.streamUsage !== false
				? { stream_options: { include_usage: true } }
				: {}),
			...samplerBody(domia),
			...slotBody(lease.slotId),
		})
		abortStream = () => stream.controller.abort()
		for await (const chunk of stream) {
			if (shouldAbort?.()) {
				stream.controller.abort()
				return
			}
			const token = chunk.choices[0]?.delta?.content
			if (token) {
				firstTokenAt ??= Date.now()
				yield token
			}
			if (chunk.choices[0]?.finish_reason)
				finishReason = chunk.choices[0].finish_reason
			if (chunk.usage && onUsage)
				onUsage(
					openAiUsage(
						chunk.usage,
						finishReason,
						timingsOf(chunk),
						domia.llmModelConfig?.contextWindow,
						chunk.id,
						wallStats(startedAt, firstTokenAt, chunk.usage.completion_tokens),
					),
				)
		}
		abortStream = null
	} catch (error) {
		maybeInvalidateSlots(domia, error)
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		safeAbort(abortStream)
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
	const lease = await acquireSlot(domia, "background", "json")
	try {
		if (shouldAbort?.()) return ""
		const stream = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(promptContext),
			temperature: cfg.temperature,
			max_tokens: JSON_NUM_PREDICT,
			response_format: { type: "json_object" },
			stream: true,
			...slotBody(lease.slotId),
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
		maybeInvalidateSlots(domia, error)
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		lease.release()
	}
}

const runOpenAiCompatibleIntent = async (
	domia: DomiaType,
	prompt: string,
	modelName: string,
): Promise<string> => {
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const lease = await acquireSlot(domia, "background", "intent")
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(prompt),
			temperature: 0,
			max_tokens: INTENT_NUM_PREDICT,
			response_format: { type: "json_object" },
			...slotBody(lease.slotId),
		})
		return response.choices[0]?.message?.content?.trim() || ""
	} catch (error) {
		maybeInvalidateSlots(domia, error)
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		lease.release()
	}
}

const warmupModel = (
	client: OpenAI,
	modelName: string,
	slotId: number | null,
): Promise<unknown> =>
	client.chat.completions.create({
		model: modelName,
		messages: userMessages("Hi"),
		max_tokens: 1,
		...slotBody(slotId),
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
	const lease = await acquireSlot(domia, "interactive", "warmup")
	try {
		for (const model of models) {
			await warmupModel(client, model, lease.slotId)
		}
	} finally {
		lease.release()
	}
}

const runOpenAiCompatibleConstrainedJson = async (
	domia: DomiaType,
	prompt: string,
	schema: Record<string, unknown>,
): Promise<string> => {
	const modelName = requireToolModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const lease = await acquireSlot(domia, "interactive", "constrainedjson")
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(prompt),
			temperature: 0,
			max_tokens: 256,
			response_format: {
				type: "json_schema",
				json_schema: { name: "tool_args", schema, strict: true },
			},
			...slotBody(lease.slotId),
		})
		return response.choices[0]?.message?.content?.trim() || ""
	} catch (error) {
		maybeInvalidateSlots(domia, error)
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		lease.release()
	}
}

const runOpenAiCompatibleChatConstrainedJson = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	schema: Record<string, unknown>,
	onUsage?: LlmUsageSinkType,
	signal?: AbortSignal,
): Promise<string> => {
	const modelName = requireToolModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const lease = await acquireSlot(domia, "interactive", "chatconstrainedjson")
	try {
		if (signal?.aborted) return ""
		const response = await client.chat.completions.create(
			{
				model: modelName,
				messages: toOpenAiMessages(messages),
				response_format: {
					type: "json_schema",
					json_schema: { name: "agent_decision", schema, strict: true },
				},
				...toolSampler(domia),
				...slotBody(lease.slotId),
			},
			{ signal },
		)
		onUsage?.(
			openAiUsage(
				response.usage,
				response.choices[0]?.finish_reason,
				timingsOf(response),
				domia.llmModelConfig?.contextWindow,
				response.id,
			),
		)
		return response.choices[0]?.message?.content?.trim() || ""
	} catch (error) {
		if (signal?.aborted) return ""
		maybeInvalidateSlots(domia, error)
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		lease.release()
	}
}

const runOpenAiCompatibleWithTools = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
	onUsage?: LlmUsageSinkType,
	toolChoice?: ToolChoiceType,
	signal?: AbortSignal,
): Promise<ToolCallOrReplyType> => {
	const modelName = requireToolModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const lease = await acquireSlot(domia, "interactive", "withtools")
	try {
		if (signal?.aborted) return { kind: "reply", text: "" }
		const response = await client.chat.completions.create(
			{
				model: modelName,
				messages: toOpenAiMessages(messages),
				tools: toOpenAiTools(tools),
				tool_choice: toolChoice === "none" ? "none" : "auto",
				...toolSampler(domia),
				...slotBody(lease.slotId),
			},
			{ signal },
		)
		onUsage?.(
			openAiUsage(
				response.usage,
				response.choices[0]?.finish_reason,
				timingsOf(response),
				domia.llmModelConfig?.contextWindow,
				response.id,
			),
		)
		const message = response.choices[0]?.message
		const toolCalls = message?.tool_calls
		if (toolCalls?.length) {
			const calls: ToolCallType[] = toolCalls
				.filter((c) => c.type === "function")
				.map((c) => ({
					name: c.function.name?.trim() || "__blank__",
					...(() => {
						const n = normalizeArgs(c.function.arguments)
						return { arguments: n.args, argsInvalid: n.invalid || undefined }
					})(),
				}))
			return { kind: "tool_calls", calls }
		}
		return { kind: "reply", text: message?.content?.trim() || "" }
	} catch (error) {
		if (signal?.aborted) return { kind: "reply", text: "" }
		maybeInvalidateSlots(domia, error)
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error },
		})
	} finally {
		lease.release()
	}
}

const runOpenAiCompatibleReplyStreamOrTools = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
	onUsage?: LlmUsageSinkType,
	toolChoice?: ToolChoiceType,
	signal?: AbortSignal,
): Promise<StreamReplyOrToolsType> => {
	const modelName = requireToolModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const lease = await acquireSlot(domia, "interactive", "replystreamortools")
	const releaseOnce = lease.release
	try {
		const startedAt = Date.now()
		const stream = await client.chat.completions.create(
			{
				model: modelName,
				messages: toOpenAiMessages(messages),
				tools: toOpenAiTools(toolChoice === "none" ? [] : tools),
				...(toolChoice === "none" ? {} : { tool_choice: "auto" }),
				...toolSampler(domia),
				stream: true,
				...(domia.llmModelConfig?.streamUsage !== false
					? { stream_options: { include_usage: true } }
					: {}),
				...slotBody(lease.slotId),
			},
			{ signal },
		)
		const iter = stream[Symbol.asyncIterator]()
		let first = await iter.next()
		while (
			!first.done &&
			!first.value.choices[0]?.delta?.tool_calls?.length &&
			!first.value.choices[0]?.delta?.content
		)
			first = await iter.next()

		const firstTokenAt = first.done ? null : Date.now()
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
							undefined,
							wallStats(
								startedAt,
								firstTokenAt,
								next.value.usage.completion_tokens,
							),
						),
					)
			}
			releaseOnce()
			const calls: ToolCallType[] = [...acc.values()].map((c) => {
				const n = normalizeArgs(c.args)
				return {
					name: c.name.trim() || "__blank__",
					arguments: n.args,
					argsInvalid: n.invalid || undefined,
				}
			})
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
								undefined,
								wallStats(
									startedAt,
									firstTokenAt,
									next.value.usage.completion_tokens,
								),
							),
						)
				}
			} finally {
				safeAbort(() => stream.controller.abort())
				releaseOnce()
			}
		})()
		const close = (): void => {
			safeAbort(() => stream.controller.abort())
			releaseOnce()
		}
		return { kind: "reply", tokens, close }
	} catch (error) {
		releaseOnce()
		maybeInvalidateSlots(domia, error)
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
	runConstrainedJson: runOpenAiCompatibleConstrainedJson,
	runChatConstrainedJson: runOpenAiCompatibleChatConstrainedJson,
	runIntent: runOpenAiCompatibleIntent,
	warmup: warmupOpenAiCompatible,
}

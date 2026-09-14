import OpenAI from "openai"

import { DomiaType } from "@/modules/core"
import { llmEngineLogger, parseLlmJson } from "@/utils"
import {
	DEFAULT_TOOL_CALL_TEMPERATURE,
	DEFAULT_TOOL_CALL_NUM_PREDICT,
	DEFAULT_TOOL_REQUEST_MAX_RETRIES,
	REASONING_EFFORT_ENUM,
} from "@/db"
import type {
	ChatMessageType,
	LlmUsageType,
	ToolDefinitionType,
} from "../../types"
import type { LlamaTimingsType, OpenAiResolvedConfigType } from "./types"
import { isLlamaServer, requireModel } from "./client"

export const openAiUsage = (
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

export const wallStats = (
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

export const safeAbort = (abort: (() => void) | null): void => {
	try {
		abort?.()
	} catch {
		return
	}
}

export const timingsOf = (raw: unknown): LlamaTimingsType | undefined =>
	raw && typeof raw === "object" && "timings" in raw
		? ((raw as { timings?: LlamaTimingsType }).timings ?? undefined)
		: undefined

export const userMessages = (
	prompt: string,
): OpenAI.Chat.ChatCompletionMessageParam[] => [
	{ role: "user", content: prompt },
]

export const samplerBody = (domia: DomiaType): Record<string, unknown> => {
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

export const reasoningBody = async (
	domia: DomiaType,
	cfg: OpenAiResolvedConfigType,
): Promise<Record<string, unknown>> => {
	const effort = domia.llmModelConfig?.reasoningEffort
	if (!effort || !(await isLlamaServer(cfg))) return {}
	return {
		reasoning_effort: effort,
		...(effort === REASONING_EFFORT_ENUM.NONE
			? { chat_template_kwargs: { enable_thinking: false } }
			: {}),
	}
}

export const toolRequestOptions = (
	domia: DomiaType,
	signal?: AbortSignal,
): { signal?: AbortSignal; maxRetries: number } => ({
	signal,
	maxRetries:
		domia.llmModelConfig?.toolRequestMaxRetries ??
		DEFAULT_TOOL_REQUEST_MAX_RETRIES,
})

export const toolSampler = (domia: DomiaType) => ({
	temperature:
		domia.llmModelConfig?.toolTemperature ?? DEFAULT_TOOL_CALL_TEMPERATURE,
	max_tokens:
		domia.llmModelConfig?.toolNumPredict ?? DEFAULT_TOOL_CALL_NUM_PREDICT,
	...samplerBody(domia),
})

export const requireToolModel = (domia: DomiaType): string =>
	domia.llmModelConfig?.toolModelName?.trim() || requireModel(domia)

export const normalizeArgs = (
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

export const toOpenAiMessages = (
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
						arguments: JSON.stringify(c.arguments),
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

export const toOpenAiTools = (
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

export const singleTokenStream = (text: string): AsyncIterable<string> => ({
	[Symbol.asyncIterator]: () => {
		let sent = false
		return {
			next: (): Promise<IteratorResult<string>> => {
				if (sent) return Promise.resolve({ done: true, value: undefined })
				sent = true
				return Promise.resolve({ done: false, value: text })
			},
		}
	},
})

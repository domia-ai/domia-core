import OpenAI from "openai"

import { DomiaType } from "@/modules/core"
import { llmEngineLogger } from "@/utils"
import { LLM_ERRORS, domiaError } from "@/utils"
import type { LlmUsageSinkType, LlmPrefillResultType } from "../../types"
import {
	acquireSlot,
	getClient,
	maybeInvalidateSlots,
	requireModel,
	resolveConfig,
	slotBody,
} from "./client"
import {
	openAiUsage,
	reasoningBody,
	safeAbort,
	samplerBody,
	timingsOf,
	userMessages,
	wallStats,
} from "./mapping"

export const runOpenAiCompatible = async (
	domia: DomiaType,
	promptContext: string,
	onUsage?: LlmUsageSinkType,
): Promise<string> => {
	const modelName = requireModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const reasoning = await reasoningBody(domia, cfg)
	const lease = await acquireSlot(domia, "interactive", "run")
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(promptContext),
			temperature: cfg.temperature,
			max_tokens: cfg.maxTokens,
			...samplerBody(domia),
			...reasoning,
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

export const runOpenAiCompatibleStream = async function* (
	domia: DomiaType,
	promptContext: string,
	shouldAbort?: () => boolean,
	onUsage?: LlmUsageSinkType,
): AsyncIterable<string> {
	const modelName = requireModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const reasoning = await reasoningBody(domia, cfg)
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
			...reasoning,
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

export const warmupOpenAiCompatible = async (
	domia: DomiaType,
): Promise<void> => {
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

const PREFILL_NUM_PREDICT = 1

export const prefillOpenAiCompatible = async (
	domia: DomiaType,
	promptContext: string,
	signal?: AbortSignal,
): Promise<LlmPrefillResultType> => {
	const modelName = requireModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const empty: LlmPrefillResultType = {
		promptTokens: null,
		freshTokens: null,
		cachedTokens: null,
		prefillMs: null,
	}
	if (signal?.aborted) return empty
	const reasoning = await reasoningBody(domia, cfg)
	const lease = await acquireSlot(domia, "interactive", "prefill")
	try {
		if (signal?.aborted) return empty
		const startedAt = Date.now()
		const response = await client.chat.completions.create(
			{
				model: modelName,
				messages: userMessages(promptContext),
				temperature: cfg.temperature,
				max_tokens: PREFILL_NUM_PREDICT,
				...samplerBody(domia),
				...reasoning,
				...slotBody(lease.slotId),
			},
			{ signal, maxRetries: 0 },
		)
		const timings = timingsOf(response)
		return {
			promptTokens: response.usage?.prompt_tokens ?? null,
			freshTokens: timings?.prompt_n ?? null,
			cachedTokens: timings?.cache_n ?? null,
			prefillMs:
				timings?.prompt_ms != null
					? Math.round(timings.prompt_ms)
					: Date.now() - startedAt,
		}
	} catch (error) {
		if (signal?.aborted) return empty
		maybeInvalidateSlots(domia, error)
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error, reason: "prefill" },
		})
	} finally {
		lease.release()
	}
}

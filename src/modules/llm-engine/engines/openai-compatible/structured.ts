import { DomiaType } from "@/modules/core"
import { llmEngineLogger } from "@/utils"
import { LLM_ERRORS, domiaError } from "@/utils"
import type { ChatMessageType, LlmUsageSinkType } from "../../types"
import {
	acquireSlot,
	decisionEngineError,
	getClient,
	maybeInvalidateSlots,
	requireModel,
	resolveConfig,
	slotBody,
} from "./client"
import {
	openAiUsage,
	reasoningBody,
	requireToolModel,
	timingsOf,
	toOpenAiMessages,
	toolSampler,
	userMessages,
} from "./mapping"

const JSON_NUM_PREDICT = 192
const INTENT_NUM_PREDICT = 48
const CONSTRAINED_JSON_NUM_PREDICT = 256

export const runOpenAiCompatibleJson = async (
	domia: DomiaType,
	promptContext: string,
	shouldAbort?: () => boolean,
): Promise<string> => {
	const modelName = requireModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const reasoning = await reasoningBody(domia, cfg)
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
			...reasoning,
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

export const runOpenAiCompatibleIntent = async (
	domia: DomiaType,
	prompt: string,
	modelName: string,
): Promise<string> => {
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const reasoning = await reasoningBody(domia, cfg)
	const lease = await acquireSlot(domia, "background", "intent")
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(prompt),
			temperature: 0,
			max_tokens: INTENT_NUM_PREDICT,
			response_format: { type: "json_object" },
			...reasoning,
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

export const runOpenAiCompatibleConstrainedJson = async (
	domia: DomiaType,
	prompt: string,
	schema: Record<string, unknown>,
): Promise<string> => {
	const modelName = requireToolModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const reasoning = await reasoningBody(domia, cfg)
	const lease = await acquireSlot(domia, "interactive", "constrainedjson")
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: userMessages(prompt),
			temperature: 0,
			max_tokens: CONSTRAINED_JSON_NUM_PREDICT,
			response_format: {
				type: "json_schema",
				json_schema: { name: "tool_args", schema, strict: true },
			},
			...reasoning,
			...slotBody(lease.slotId),
		})
		return response.choices[0]?.message?.content?.trim() || ""
	} catch (error) {
		maybeInvalidateSlots(domia, error)
		throw decisionEngineError(error)
	} finally {
		lease.release()
	}
}

export const runOpenAiCompatibleChatConstrainedJson = async (
	domia: DomiaType,
	messages: ChatMessageType[],
	schema: Record<string, unknown>,
	onUsage?: LlmUsageSinkType,
	signal?: AbortSignal,
): Promise<string> => {
	const modelName = requireToolModel(domia)
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const reasoning = await reasoningBody(domia, cfg)
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
				...reasoning,
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
		throw decisionEngineError(error)
	} finally {
		lease.release()
	}
}

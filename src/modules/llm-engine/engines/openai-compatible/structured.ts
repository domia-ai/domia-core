import { DomiaType } from "@/modules/core"
import { llmEngineLogger } from "@/utils"
import { LLM_ERRORS, domiaError } from "@/utils"
import type {
	ChatMessageType,
	LlmChoiceRequestType,
	LlmUsageSinkType,
} from "../../types"
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
const JSON_ABORT_POLL_MS = 50
const CHOICE_CHARS_PER_TOKEN = 2
const CHOICE_SPARE_TOKENS = 2
const CHOICE_VALUE_END = '"'
const CONSTRAINED_JSON_NUM_PREDICT = 256

const choiceNumPredict = (choices: string[]): number =>
	Math.ceil(
		Math.max(...choices.map((c) => c.length)) / CHOICE_CHARS_PER_TOKEN,
	) + CHOICE_SPARE_TOKENS

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
		const abortWatch = shouldAbort
			? setInterval(() => {
					if (shouldAbort()) stream.controller.abort()
				}, JSON_ABORT_POLL_MS)
			: null
		try {
			for await (const chunk of stream) {
				if (shouldAbort?.()) {
					stream.controller.abort()
					return ""
				}
				out += chunk.choices[0]?.delta?.content ?? ""
			}
		} catch (error) {
			if (shouldAbort?.()) return ""
			throw error
		} finally {
			if (abortWatch) clearInterval(abortWatch)
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

export const runOpenAiCompatibleChoice = async (
	domia: DomiaType,
	request: LlmChoiceRequestType,
	modelName: string,
): Promise<string | null> => {
	const cfg = resolveConfig(domia)
	const client = getClient(cfg)
	const reasoning = await reasoningBody(domia, cfg)
	const lease = await acquireSlot(domia, "router", "intent", true)
	try {
		const response = await client.chat.completions.create({
			model: modelName,
			messages: [
				{ role: "system", content: request.system },
				{ role: "user", content: request.user },
				{ role: "assistant", content: `{"${request.key}": "` },
			],
			temperature: 0,
			max_tokens: choiceNumPredict(request.choices),
			stop: [CHOICE_VALUE_END],
			...reasoning,
			...slotBody(lease.slotId),
		})
		const chosen = (response.choices[0]?.message?.content ?? "")
			.split(CHOICE_VALUE_END)
			.at(-1)
			?.trim()
		return chosen && request.choices.includes(chosen) ? chosen : null
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

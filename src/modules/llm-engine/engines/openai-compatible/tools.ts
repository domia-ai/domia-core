import OpenAI from "openai"

import { DomiaType } from "@/modules/core"
import { llmEngineLogger, AGENT_ERRORS, domiaError } from "@/utils"
import type {
	ChatMessageType,
	ToolCallType,
	ToolCallOrReplyType,
	ToolChoiceType,
	StreamReplyOrToolsType,
	ToolDefinitionType,
	LlmUsageSinkType,
} from "../../types"
import type { GrammarStreamVerdictType, ToolCallAccType } from "./types"
import {
	acquireSlot,
	decisionEngineError,
	getClient,
	isLlamaServer,
	maybeInvalidateSlots,
	resolveConfig,
	slotBody,
} from "./client"
import {
	createGrammarStreamGate,
	flattenToolHistory,
	parseGrammarDecision,
	toolGrammar,
	withToolCatalog,
} from "./grammar"
import {
	normalizeArgs,
	openAiUsage,
	reasoningBody,
	requireToolModel,
	safeAbort,
	singleTokenStream,
	timingsOf,
	toOpenAiMessages,
	toOpenAiTools,
	toolRequestOptions,
	toolSampler,
	wallStats,
} from "./mapping"

const decisionBody = (
	tools: ToolDefinitionType[],
	toolChoice: ToolChoiceType | undefined,
	grammarMode: boolean,
): Record<string, unknown> => {
	if (toolChoice === "none") return {}
	if (grammarMode) return { grammar: toolGrammar(tools) }
	return { tools: toOpenAiTools(tools), tool_choice: "auto" }
}

export const runOpenAiCompatibleWithTools = async (
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
	const grammarMode =
		toolChoice !== "none" && tools.length > 0 && (await isLlamaServer(cfg))
	const reasoning = await reasoningBody(domia, cfg)
	const lease = await acquireSlot(domia, "interactive", "withtools")
	try {
		if (signal?.aborted) return { kind: "reply", text: "" }
		const body = {
			model: modelName,
			messages: toOpenAiMessages(
				grammarMode
					? withToolCatalog(flattenToolHistory(messages), tools)
					: messages,
			),
			...decisionBody(tools, toolChoice, grammarMode),
			...toolSampler(domia),
			...reasoning,
			...slotBody(lease.slotId),
		}
		const response = await client.chat.completions.create(
			body,
			toolRequestOptions(domia, signal),
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
		if (grammarMode) {
			const decision = parseGrammarDecision(
				message.content ?? "",
				tools,
				modelName,
			)
			if (!decision)
				throw domiaError(AGENT_ERRORS.DECISION_UNPARSEABLE, {
					logger: llmEngineLogger,
					messageOverride:
						"The model produced no usable tool call or answer under the tool grammar.",
					meta: { model: modelName, modelOutput: message.content ?? "" },
				})
			return decision
		}
		const toolCalls = message.tool_calls
		if (toolCalls?.length) {
			const calls: ToolCallType[] = toolCalls
				.filter((c) => c.type === "function")
				.map((c) => ({
					name: c.function.name.trim() || "__blank__",
					...(() => {
						const n = normalizeArgs(c.function.arguments)
						return { arguments: n.args, argsInvalid: n.invalid || undefined }
					})(),
				}))
			return { kind: "tool_calls", calls }
		}
		return { kind: "reply", text: message.content?.trim() || "" }
	} catch (error) {
		if (signal?.aborted) return { kind: "reply", text: "" }
		maybeInvalidateSlots(domia, error)
		throw decisionEngineError(error)
	} finally {
		lease.release()
	}
}

export const runOpenAiCompatibleReplyStreamOrTools = async (
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
	const grammarMode =
		toolChoice !== "none" && tools.length > 0 && (await isLlamaServer(cfg))
	const reasoning = await reasoningBody(domia, cfg)
	const lease = await acquireSlot(domia, "interactive", "replystreamortools")
	const releaseOnce = lease.release
	try {
		const startedAt = Date.now()
		const stream = await client.chat.completions.create(
			{
				model: modelName,
				messages: toOpenAiMessages(
					grammarMode
						? withToolCatalog(flattenToolHistory(messages), tools)
						: messages,
				),
				...decisionBody(tools, toolChoice, grammarMode),
				...toolSampler(domia),
				...reasoning,
				stream: true,
				...(domia.llmModelConfig?.streamUsage !== false
					? { stream_options: { include_usage: true } }
					: {}),
				...slotBody(lease.slotId),
			},
			toolRequestOptions(domia, signal),
		)
		const iter = stream[Symbol.asyncIterator]()

		if (grammarMode) {
			const gate = createGrammarStreamGate(tools)
			let firstContentAt: number | null = null
			let grammarFinishReason: string | null = null
			const record = (chunk: OpenAI.Chat.ChatCompletionChunk): void => {
				if (chunk.choices[0]?.finish_reason)
					grammarFinishReason = chunk.choices[0].finish_reason
				if (chunk.usage && onUsage)
					onUsage(
						openAiUsage(
							chunk.usage,
							grammarFinishReason,
							timingsOf(chunk),
							domia.llmModelConfig?.contextWindow,
							chunk.id,
							wallStats(
								startedAt,
								firstContentAt,
								chunk.usage.completion_tokens,
							),
						),
					)
			}
			let verdict: GrammarStreamVerdictType = { state: "pending" }
			let exhausted = false
			while (verdict.state === "pending") {
				const next = await iter.next()
				if (next.done) {
					exhausted = true
					verdict = gate.end()
					break
				}
				record(next.value)
				const token = next.value.choices[0]?.delta?.content
				if (!token) continue
				firstContentAt ??= Date.now()
				verdict = gate.push(token)
			}

			if (verdict.state === "decision") {
				while (!exhausted) {
					const next = await iter.next()
					if (next.done) break
					record(next.value)
					const token = next.value.choices[0]?.delta?.content
					if (token) gate.push(token)
				}
				releaseOnce()
				const raw = gate.buffered()
				const decision = parseGrammarDecision(raw, tools, modelName)
				if (decision?.kind === "tool_calls")
					return { kind: "tool_calls", calls: decision.calls }
				llmEngineLogger.warn(
					"grammar stream gated a decision that did not parse — replying with the raw text",
					{ model: modelName, rawLength: raw.length },
				)
				return {
					kind: "reply",
					tokens: singleTokenStream(raw.trim()),
					close: (): void => undefined,
				}
			}

			const opening = verdict.state === "reply" ? verdict.flush : ""
			const grammarTokens = (async function* (): AsyncIterable<string> {
				try {
					if (opening) yield opening
					if (exhausted) return
					while (true) {
						const next = await iter.next()
						if (next.done) break
						record(next.value)
						const token = next.value.choices[0]?.delta?.content
						if (token) yield token
					}
				} finally {
					safeAbort(() => stream.controller.abort())
					releaseOnce()
				}
			})()
			return {
				kind: "reply",
				tokens: grammarTokens,
				close: (): void => {
					safeAbort(() => stream.controller.abort())
					releaseOnce()
				},
			}
		}

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
					const idx = tc.index
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
		throw decisionEngineError(error)
	}
}

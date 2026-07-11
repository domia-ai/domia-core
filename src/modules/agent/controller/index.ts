import {
	DEFAULT_AGENT_MAX_STEPS,
	DEFAULT_AGENT_BUDGET_MS,
	DEFAULT_CONFIRMATION_TTL_MS,
	DEFAULT_SLOW_TOOL_AFTER_MS,
	DEFAULT_AGENT_ACK_AFTER_MS,
	SKILL_TOOL_NAME_SEPARATOR,
	AGENT_PROMPT_MODE_ENUM,
	DEFAULT_FINALIZE_ACK,
	DEFAULT_FINALIZE_ERROR,
	DEFAULT_LLM_MODEL_CONTEXT_WINDOW,
} from "@/db"
import type {
	SkillToolType,
	ToolTraceEntryType,
	ToolRunStatusType,
	ToolResultErrorCodeType,
} from "@/db"
import {
	languageSetsFor,
	getTraceContext,
	wrapUntrustedToolOutput,
} from "@/utils"
import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import type { DomiaType } from "@/modules/core"
import type {
	ChatMessageType,
	ToolCallOrReplyType,
	ToolDefinitionType,
} from "@/modules/llm-engine"
import {
	callTool,
	resolveSkillArgs,
	resolveToolFinalize,
	renderFinalizeText,
	getToolPolicy,
	getProviderResilience,
	type SkillCallResultType,
} from "@/modules/skill-engine"
import {
	parkConfirmation,
	confirmationScope,
	summarizeConfirmAction,
} from "../utils"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import { agentLogger } from "@/utils"

import {
	SKILLS_CLAUSE,
	AGENT_FAILURE_REPLY,
	AGENT_ACTED_FAILURE_REPLY,
} from "../constants"
import type {
	AgentInferenceType,
	AgentResultType,
	AgentTurnOptionsType,
	AsyncToolOutcomeType,
} from "../types"

const ABORTED = Symbol("agent-aborted")

const TOOL_RESULT_COMPACT_CAP = 240
const COMPACT_SUFFIX = " …[truncated]"

const mapSkillStatus = (
	status: SkillCallResultType["status"],
): ToolRunStatusType =>
	status === "ok" ? "ok" : status === "timeout" ? "timeout" : "failed"

const skillErrorCode = (
	status: SkillCallResultType["status"],
): ToolResultErrorCodeType | undefined => (status === "ok" ? undefined : status)

const toToolTraceEntry = (
	tool: string,
	result: SkillCallResultType,
	durationMs: number,
	args: Record<string, unknown>,
): ToolTraceEntryType => ({
	kind: "result",
	tool,
	status: mapSkillStatus(result.status),
	durationMs,
	summaryForLlm: result.text,
	output: result.text,
	errorCode: skillErrorCode(result.status),
	args,
	resolvedArgs: result.resolvedArgs,
})

const providerOf = (toolName: string): string | undefined => {
	const sepIdx = toolName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	return sepIdx > 0 ? toolName.slice(0, sepIdx) : undefined
}

const emitToolRequested = (toolName: string): void => {
	const ctx = getTraceContext()
	if (!ctx?.interactionId) return
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.TOOL_REQUESTED,
		interactionId: ctx.interactionId,
		originDomiaKey: ctx.originDomiaKey ?? "",
		traceId: ctx.traceId,
		toolName,
		provider: providerOf(toolName),
	})
}

const emitToolResult = (
	toolName: string,
	status: ToolRunStatusType,
	toolMs?: number,
): void => {
	const ctx = getTraceContext()
	if (!ctx?.interactionId) return
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.TOOL_RESULT,
		interactionId: ctx.interactionId,
		originDomiaKey: ctx.originDomiaKey ?? "",
		traceId: ctx.traceId,
		toolName,
		status,
		toolMs,
	})
}

export const estimateTokens = (messages: ChatMessageType[]): number => {
	let chars = 0
	for (const m of messages) {
		chars += m.content.length
		if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length
	}
	return Math.ceil(chars / 4)
}

export const compactWithinBudget = (
	messages: ChatMessageType[],
	budgetTokens: number,
): boolean => {
	if (estimateTokens(messages) <= budgetTokens) return true
	for (const m of messages) {
		if (estimateTokens(messages) <= budgetTokens) return true
		if (m.role === "tool" && m.content.length > TOOL_RESULT_COMPACT_CAP) {
			m.content = m.content.slice(0, TOOL_RESULT_COMPACT_CAP) + COMPACT_SUFFIX
		}
	}
	return estimateTokens(messages) <= budgetTokens
}

const raceAbort = <T>(
	p: Promise<T>,
	signal?: AbortSignal,
): Promise<T | typeof ABORTED> => {
	if (!signal) return p as Promise<T | typeof ABORTED>
	if (signal.aborted) return Promise.resolve(ABORTED)
	return new Promise((resolve, reject) => {
		const onAbort = (): void => resolve(ABORTED)
		signal.addEventListener("abort", onAbort, { once: true })
		p.then(
			(v) => {
				signal.removeEventListener("abort", onAbort)
				resolve(v)
			},
			(e) => {
				signal.removeEventListener("abort", onAbort)
				reject(e)
			},
		)
	})
}

const isEmptyArg = (v: unknown): boolean =>
	v == null ||
	v === "" ||
	(Array.isArray(v) && v.length === 0) ||
	(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)

const pruneEmptyArgs = (
	args: Record<string, unknown>,
): Record<string, unknown> => {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(args)) if (!isEmptyArg(v)) out[k] = v
	return out
}

const filterToAllowed = (
	args: Record<string, unknown>,
	allow: Set<string> | null | undefined,
): Record<string, unknown> => {
	if (allow == null) return args
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(args)) if (allow.has(k)) out[k] = v
	return out
}

const toToolDefs = (tools: SkillToolType[]): ToolDefinitionType[] =>
	tools.map((t) => ({
		name: t.namespacedName,
		description: t.description,
		parameters: t.inputSchema,
	}))

const buildAgentSystem = (domia: DomiaType, transcript: string): string => {
	const mode =
		domia.llmModelConfig?.agentPromptMode ?? AGENT_PROMPT_MODE_ENUM.COMPACT
	if (mode === AGENT_PROMPT_MODE_ENUM.FULL) {
		const persona = buildPromptContext(domia, transcript, {
			omitUserInput: true,
		})
		return `### HOME CONTROL (highest priority)\n${SKILLS_CLAUSE}\n\n${persona}`
	}
	const cp = domia.characterProfile
	const name = cp?.name?.trim() || "Domia"
	const lang = cp?.language || "en"
	const replyRule = `When you are not calling a tool, answer in one short, natural sentence in the user's language (default ${lang}); never describe the tools or your reasoning.`
	if (mode === AGENT_PROMPT_MODE_ENUM.LEAN) {
		return `${SKILLS_CLAUSE}\n\nYou are ${name}. ${replyRule}`
	}
	const traits = [cp?.personality, cp?.communicationStyle]
		.map((t) => t?.trim().toLowerCase())
		.filter((t): t is string => Boolean(t) && t !== "neutral")
		.join(", ")
	const personaLine = traits
		? `You are ${name} — ${traits}.`
		: `You are ${name}.`
	return `${SKILLS_CLAUSE}\n\n${personaLine} ${replyRule} Stay in character.`
}

export const runAgentTurn = async (
	domia: DomiaType,
	transcript: string,
	tools: SkillToolType[],
	inference: AgentInferenceType,
	opts?: AgentTurnOptionsType,
): Promise<AgentResultType> => {
	const toolDefs = toToolDefs(tools)
	const system = buildAgentSystem(domia, transcript)
	const messages: ChatMessageType[] = [
		{ role: "system", content: system },
		{ role: "user", content: transcript },
	]
	const toolNamesUsed: string[] = []
	const serversUsed = new Set<string>()
	const skillResponses: ToolTraceEntryType[] = []
	let decisionMs = 0
	let toolMs = 0
	let finalizeMs = 0
	const maxSteps =
		domia.llmModelConfig?.agentMaxSteps ?? DEFAULT_AGENT_MAX_STEPS
	const budgetMs =
		opts?.budgetMs ??
		domia.llmModelConfig?.agentBudgetMs ??
		DEFAULT_AGENT_BUDGET_MS
	const budgetSignals: AbortSignal[] = []
	if (opts?.signal) budgetSignals.push(opts.signal)
	if (budgetMs > 0) budgetSignals.push(AbortSignal.timeout(budgetMs))
	const effectiveSignal =
		budgetSignals.length === 0
			? undefined
			: budgetSignals.length === 1
				? budgetSignals[0]
				: AbortSignal.any(budgetSignals)
	const idemCache = new Map<
		string,
		{ result: SkillCallResultType; ms: number }
	>()
	const idemKey = (name: string, args: Record<string, unknown>): string =>
		`${name}:${JSON.stringify(args)}`
	const contextWindow =
		domia.llmModelConfig?.contextWindow ?? DEFAULT_LLM_MODEL_CONTEXT_WINDOW
	const numPredict = Math.max(0, domia.llmModelConfig?.numPredict ?? 0)
	const tokenBudget = Math.max(512, contextWindow - numPredict - 256)
	const allowedParams = new Map<string, Set<string> | null>(
		tools.map((t) => {
			const props = t.inputSchema?.properties as
				| Record<string, unknown>
				| undefined
			return [
				t.namespacedName,
				props && typeof props === "object" ? new Set(Object.keys(props)) : null,
			]
		}),
	)
	const requiredParams = new Map<string, string[]>(
		tools.map((t) => {
			const req = t.inputSchema?.required
			return [t.namespacedName, Array.isArray(req) ? req.map(String) : []]
		}),
	)
	const argCorrected = new Set<string>()
	const knownToolNames = new Set(toolDefs.map((t) => t.name))
	const erroredCalls = new Map<string, string>()
	const callKey = (name: string, args: Record<string, unknown>): string =>
		`${name}:${JSON.stringify(args)}`
	let forceNoTool = false

	const abortedReturn = (step: number): AgentResultType => ({
		reply: "",
		toolNamesUsed,
		serversUsed: [...serversUsed],
		steps: step + 1,
		skillPrompt: SKILLS_CLAUSE,
		skillResponses,
		decisionMs,
		toolMs,
		finalizeMs,
		finalizeMode: "agent_loop",
		stopReason: "aborted",
	})

	for (let step = 0; step < maxSteps; step++) {
		if (effectiveSignal?.aborted) return abortedReturn(step)
		if (!compactWithinBudget(messages, tokenBudget)) {
			agentLogger.warn("agent context overflow — compaction insufficient", {
				domiaId: domia.id,
				step,
				tokens: estimateTokens(messages),
				budget: tokenBudget,
			})
			return {
				reply:
					toolNamesUsed.length > 0
						? AGENT_ACTED_FAILURE_REPLY
						: AGENT_FAILURE_REPLY,
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "agent_loop",
				stopReason: "context_overflow",
			}
		}
		let out: ToolCallOrReplyType
		const noTool = forceNoTool || step === maxSteps - 1
		const streamFinalize =
			opts?.voice && opts.streamFinalize && toolNamesUsed.length > 0 && !noTool
				? opts.streamFinalize
				: null
		const inferStart = process.hrtime.bigint()
		try {
			if (streamFinalize) {
				const res = await raceAbort(
					streamFinalize(messages, toolDefs),
					effectiveSignal,
				)
				if (res === ABORTED) return abortedReturn(step)
				if (res.kind === "reply") {
					return {
						reply: "",
						replyStream: res.tokens,
						toolNamesUsed,
						serversUsed: [...serversUsed],
						steps: step + 1,
						skillPrompt: SKILLS_CLAUSE,
						skillResponses,
						decisionMs,
						toolMs,
						finalizeMs,
						finalizeMode: "streamed",
						stopReason: "completed",
					}
				}
				out = { kind: "tool_calls", calls: res.calls }
			} else {
				const inferred = await raceAbort(
					inference(messages, toolDefs, noTool ? "none" : undefined),
					effectiveSignal,
				)
				if (inferred === ABORTED) return abortedReturn(step)
				out = inferred
			}
		} catch (err) {
			if (toolNamesUsed.length === 0) throw err
			agentLogger.warn(
				"agent inference failed after a tool ran — not falling back",
				{ domiaId: domia.id, toolNamesUsed, err },
			)
			return {
				reply: AGENT_ACTED_FAILURE_REPLY,
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "agent_loop",
				stopReason: "tool_error",
			}
		}
		const inferMs = Math.round(
			Number(process.hrtime.bigint() - inferStart) / 1e6,
		)

		if (out.kind === "reply") {
			finalizeMs += inferMs
			return {
				reply: out.text,
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "agent_loop",
				stopReason: "completed",
			}
		}

		decisionMs += inferMs
		messages.push({ role: "assistant", content: "", toolCalls: out.calls })

		const confirmCall = out.calls.find((call) => {
			if (getToolPolicy(domia.id, call.name) !== "confirm") return false
			if (!knownToolNames.has(call.name)) return false
			const safeArgs = pruneEmptyArgs(
				filterToAllowed(call.arguments, allowedParams.get(call.name)),
			)
			const required = requiredParams.get(call.name) ?? []
			const missing = required.some((r) => !(r in safeArgs))
			return !missing || argCorrected.has(call.name)
		})
		if (confirmCall) {
			const droppedSiblings = out.calls
				.filter((c) => c !== confirmCall)
				.map((c) => c.name)
			const language = domia.characterProfile?.language ?? null
			const confirmArgs = pruneEmptyArgs(
				filterToAllowed(
					confirmCall.arguments,
					allowedParams.get(confirmCall.name),
				),
			)
			const resolution = await resolveSkillArgs(
				domia.id,
				confirmCall.name,
				confirmArgs,
			)
			if (!resolution.ok) {
				const phrases = languageSetsFor(language).phrases
				return {
					reply: phrases.cantDoThat ?? DEFAULT_FINALIZE_ERROR,
					toolNamesUsed,
					serversUsed: [...serversUsed],
					steps: step + 1,
					skillPrompt: SKILLS_CLAUSE,
					skillResponses,
					decisionMs,
					toolMs,
					finalizeMs,
					finalizeMode: "agent_loop",
					stopReason: "completed",
				}
			}
			const summary = summarizeConfirmAction(
				confirmCall.name,
				resolution.resolvedArgs,
			)
			parkConfirmation(
				confirmationScope(domia.domiaKey, opts?.confirmationChannel),
				{
					tool: confirmCall.name,
					args: confirmArgs,
					resolvedArgs: resolution.resolvedArgs,
					language,
					summary,
				},
				domia.llmModelConfig?.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS,
			)
			const confirmPhrase =
				languageSetsFor(language).phrases.confirmAction ??
				"Do you want me to go ahead with that?"
			const siblingNote =
				droppedSiblings.length > 0
					? ` I'll hold off on the rest until you confirm.`
					: ""
			return {
				reply: summary
					? `${summary} ${confirmPhrase}${siblingNote}`
					: `${confirmPhrase}${siblingNote}`,
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "agent_loop",
				stopReason: "confirm_required",
			}
		}

		const allAsync =
			opts?.allowAsyncTools === true &&
			out.calls.length > 0 &&
			out.calls.every(
				(call) => resolveToolFinalize(domia.id, call.name)?.mode === "async",
			)
		if (allAsync) {
			const pendingTools: Promise<AsyncToolOutcomeType>[] = []
			const ackParts: string[] = []
			for (const call of out.calls) {
				toolNamesUsed.push(call.name)
				const sepIdx = call.name.indexOf(SKILL_TOOL_NAME_SEPARATOR)
				if (sepIdx > 0) serversUsed.add(call.name.slice(0, sepIdx))
				const rule = resolveToolFinalize(domia.id, call.name)
				ackParts.push(
					rule?.ack ??
						languageSetsFor(domia.characterProfile?.language).phrases.onIt,
				)
				const safeArgs = pruneEmptyArgs(
					filterToAllowed(call.arguments, allowedParams.get(call.name)),
				)
				skillResponses.push({
					kind: "dispatched",
					tool: call.name,
					args: safeArgs,
				})
				emitToolRequested(call.name)
				const phrases = languageSetsFor(
					domia.characterProfile?.language,
				).phrases
				pendingTools.push(
					callTool(domia.id, call.name, safeArgs)
						.then((result) => {
							const ok = result.status === "ok" && !result.isError
							const template = ok ? rule?.done : rule?.error
							const fallback = ok
								? phrases.thatIsDone
								: (phrases.cantDoThat ?? DEFAULT_FINALIZE_ERROR)
							return {
								tool: call.name,
								ok,
								doneText: template
									? (renderFinalizeText(
											template,
											safeArgs,
											result.resolvedArgs,
										) ?? fallback)
									: fallback,
								resolvedArgs: result.resolvedArgs,
							}
						})
						.catch(() => ({
							tool: call.name,
							ok: false,
							doneText:
								rule?.error && !rule.error.includes("{")
									? rule.error
									: (phrases.cantDoThat ?? DEFAULT_FINALIZE_ERROR),
						})),
				)
			}
			agentLogger.info(
				`agent async tools dispatched (${out.calls.length}) — respond-first`,
				{ domiaId: domia.id, tools: toolNamesUsed },
			)
			return {
				reply: [...new Set(ackParts)].join(" "),
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "template",
				stopReason: "completed",
				pendingTools,
			}
		}

		const templateParts: string[] = []
		let allTemplate = true
		const toRun: {
			call: (typeof out.calls)[number]
			safeArgs: Record<string, unknown>
		}[] = []
		for (const call of out.calls) {
			if (call.argsInvalid) {
				allTemplate = false
				messages.push({
					role: "tool",
					toolName: call.name,
					content: `Error: the arguments for "${call.name}" were not valid JSON. Call it again with well-formed JSON arguments.`,
				})
				agentLogger.warn("agent tool call had unparseable args — rejected", {
					domiaId: domia.id,
					name: call.name,
				})
				continue
			}
			if (!knownToolNames.has(call.name)) {
				allTemplate = false
				messages.push({
					role: "tool",
					toolName: call.name,
					content: `Error: no tool named "${call.name}" exists. Available tools: ${[...knownToolNames].join(", ")}. Pick one of these or reply without a tool.`,
				})
				agentLogger.warn("agent called unknown tool — corrected", {
					domiaId: domia.id,
					name: call.name,
				})
				continue
			}
			const safeArgs = pruneEmptyArgs(
				filterToAllowed(call.arguments, allowedParams.get(call.name)),
			)
			const missing = (requiredParams.get(call.name) ?? []).filter(
				(k) => safeArgs[k] === undefined,
			)
			if (missing.length > 0) {
				allTemplate = false
				const retry = argCorrected.has(call.name)
				argCorrected.add(call.name)
				if (retry) forceNoTool = true
				messages.push({
					role: "tool",
					toolName: call.name,
					content: retry
						? `Error: "${call.name}" is still missing required argument(s): ${missing.join(", ")}. Do not call it again — tell the user you need ${missing.join(" and ")}.`
						: `Error: "${call.name}" is missing required argument(s): ${missing.join(", ")}. You sent ${JSON.stringify(safeArgs)}. Call "${call.name}" again with ${missing.join(" and ")} filled in.`,
				})
				agentLogger.warn("agent tool call missing required args", {
					domiaId: domia.id,
					name: call.name,
					missing,
					retry,
				})
				continue
			}
			const key = callKey(call.name, safeArgs)
			if (erroredCalls.has(key)) {
				allTemplate = false
				forceNoTool = true
				messages.push({
					role: "tool",
					toolName: call.name,
					content: `Error: "${call.name}" was already attempted with these arguments and failed: ${erroredCalls.get(key)}. Do not retry it — tell the user it couldn't be done.`,
				})
				agentLogger.warn(
					"agent re-issued an already-failed tool call — blocked",
					{
						domiaId: domia.id,
						name: call.name,
					},
				)
				continue
			}
			if (toRun.some((r) => callKey(r.call.name, r.safeArgs) === key)) continue
			toolNamesUsed.push(call.name)
			const sepIdx = call.name.indexOf(SKILL_TOOL_NAME_SEPARATOR)
			if (sepIdx > 0) serversUsed.add(call.name.slice(0, sepIdx))
			toRun.push({ call, safeArgs })
			emitToolRequested(call.name)
		}

		const markCancelled = (): void => {
			for (const { call, safeArgs } of toRun) {
				skillResponses.push({
					kind: "result",
					tool: call.name,
					status: "cancelled",
					durationMs: 0,
					summaryForLlm: "",
					args: safeArgs,
				})
				emitToolResult(call.name, "cancelled")
			}
		}

		if (toRun.length > 0) {
			const allDeadline =
				opts?.allowAsyncTools === true &&
				toRun.every(
					({ call }) =>
						resolveToolFinalize(domia.id, call.name)?.mode === "deadline",
				)
			let slowTimer: ReturnType<typeof setTimeout> | null = null
			if (opts?.onSlowTool && !allDeadline) {
				slowTimer = setTimeout(
					opts.onSlowTool,
					opts.slowToolAfterMs ?? DEFAULT_SLOW_TOOL_AFTER_MS,
				)
				slowTimer.unref()
			}
			const runOne = async (
				name: string,
				args: Record<string, unknown>,
				signal?: AbortSignal,
			) => {
				const idempotent =
					getProviderResilience(domia.id, providerOf(name) ?? "")
						?.idempotentWithinTurn === true
				const key = idempotent ? idemKey(name, args) : null
				if (key) {
					const cached = idemCache.get(key)
					if (cached) return cached
				}
				const started = process.hrtime.bigint()
				try {
					const result = await callTool(domia.id, name, args, signal)
					const out = {
						result,
						ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
					}
					if (key && result.status === "ok" && !result.isError)
						idemCache.set(key, out)
					return out
				} catch (err) {
					return {
						result: {
							text: String(err),
							status: "error" as const,
							isError: true,
						},
						ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
					}
				}
			}
			const running = toRun.map((p) =>
				runOne(
					p.call.name,
					p.safeArgs,
					allDeadline ? undefined : effectiveSignal,
				),
			)
			let settled: Awaited<(typeof running)[number]>[]
			if (allDeadline) {
				const ackAfterMs = Math.min(
					...toRun.map(
						({ call }) =>
							resolveToolFinalize(domia.id, call.name)?.ackAfterMs ??
							domia.llmModelConfig?.agentAckAfterMs ??
							DEFAULT_AGENT_ACK_AFTER_MS,
					),
				)
				let deadlineTimer: ReturnType<typeof setTimeout> | null = null
				const raced = await raceAbort(
					Promise.race([
						Promise.all(running).then((s) => ({
							deadline: false as const,
							settled: s,
						})),
						new Promise<{ deadline: true }>((resolve) => {
							deadlineTimer = setTimeout(
								() => resolve({ deadline: true }),
								ackAfterMs,
							)
							deadlineTimer.unref()
						}),
					]),
					effectiveSignal,
				)
				if (deadlineTimer) clearTimeout(deadlineTimer)
				if (raced === ABORTED) {
					markCancelled()
					return abortedReturn(step)
				}
				if (raced.deadline) {
					const phrases = languageSetsFor(
						domia.characterProfile?.language,
					).phrases
					const ackParts: string[] = []
					const pendingTools: Promise<AsyncToolOutcomeType>[] = []
					for (let i = 0; i < toRun.length; i++) {
						const { call, safeArgs } = toRun[i]
						const rule = resolveToolFinalize(domia.id, call.name)
						ackParts.push(rule?.ack ?? phrases.onIt)
						skillResponses.push({
							kind: "dispatched",
							tool: call.name,
							args: safeArgs,
						})
						pendingTools.push(
							running[i].then(({ result }) => {
								const ok = result.status === "ok" && !result.isError
								const template = ok ? rule?.done : rule?.error
								const fallback = ok
									? phrases.thatIsDone
									: (phrases.cantDoThat ?? DEFAULT_FINALIZE_ERROR)
								return {
									tool: call.name,
									ok,
									doneText: template
										? (renderFinalizeText(
												template,
												safeArgs,
												result.resolvedArgs,
											) ?? fallback)
										: fallback,
									resolvedArgs: result.resolvedArgs,
								}
							}),
						)
					}
					agentLogger.info(
						`agent deadline ack (${toRun.length}) — respond-first after ${ackAfterMs}ms`,
						{ domiaId: domia.id, tools: toRun.map((p) => p.call.name) },
					)
					return {
						reply: [...new Set(ackParts)].join(" "),
						toolNamesUsed,
						serversUsed: [...serversUsed],
						steps: step + 1,
						skillPrompt: SKILLS_CLAUSE,
						skillResponses,
						decisionMs,
						toolMs,
						finalizeMs,
						finalizeMode: "template",
						stopReason: "completed",
						pendingTools,
					}
				}
				settled = raced.settled
			} else {
				const awaited = await raceAbort(Promise.all(running), effectiveSignal)
				if (slowTimer) clearTimeout(slowTimer)
				if (awaited === ABORTED) {
					markCancelled()
					return abortedReturn(step)
				}
				settled = awaited
			}
			toolMs += settled.reduce((m, s) => Math.max(m, s.ms), 0)
			const phrases = languageSetsFor(domia.characterProfile?.language).phrases
			for (let i = 0; i < toRun.length; i++) {
				const { call, safeArgs } = toRun[i]
				const { result } = settled[i]
				const entry = toToolTraceEntry(
					call.name,
					result,
					settled[i].ms,
					safeArgs,
				)
				skillResponses.push(entry)
				emitToolResult(call.name, mapSkillStatus(result.status), settled[i].ms)
				if (result.status !== "ok" || result.isError)
					erroredCalls.set(
						callKey(call.name, safeArgs),
						result.text.slice(0, 120),
					)
				const guarded = wrapUntrustedToolOutput(call.name, result.text)
				if (guarded.flagged) {
					agentLogger.warn("tool output flagged by injection guard", {
						domiaId: domia.id,
						name: call.name,
						reasons: guarded.reasons,
					})
				}
				messages.push({
					role: "tool",
					toolName: call.name,
					content: guarded.text,
				})
				const rule = resolveToolFinalize(domia.id, call.name)
				if (rule?.mode === "template" || rule?.mode === "deadline") {
					const ok = result.status === "ok" && !result.isError
					const template = ok
						? rule.mode === "deadline"
							? (rule.done ?? rule.ack)
							: rule.ack
						: rule.error
					const fallback = ok
						? (phrases.done ?? DEFAULT_FINALIZE_ACK)
						: (phrases.cantDoThat ?? DEFAULT_FINALIZE_ERROR)
					const rendered = template
						? (renderFinalizeText(template, safeArgs, result.resolvedArgs) ??
							fallback)
						: fallback
					templateParts.push(rendered)
					if (entry.kind === "result") entry.displaySummary = rendered
				} else {
					allTemplate = false
				}
			}
		}
		if (allTemplate && templateParts.length > 0) {
			return {
				reply: templateParts.join(" "),
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "template",
				stopReason: "completed",
			}
		}
	}

	agentLogger.warn("agent loop exhausted max steps", {
		domiaId: domia.id,
		toolNamesUsed,
	})
	return {
		reply:
			toolNamesUsed.length > 0
				? AGENT_ACTED_FAILURE_REPLY
				: AGENT_FAILURE_REPLY,
		toolNamesUsed,
		serversUsed: [...serversUsed],
		steps: maxSteps,
		skillPrompt: SKILLS_CLAUSE,
		skillResponses,
		decisionMs,
		toolMs,
		finalizeMs,
		finalizeMode: "agent_loop",
		stopReason: "max_steps",
	}
}

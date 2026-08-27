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
	DEFAULT_AGENT_REPEAT_WARN_AT,
	DEFAULT_AGENT_REPEAT_BLOCK_AT,
	DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN,
	DEFAULT_CONSTRAINED_REPAIR_ENABLED,
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
	coerceArgsToSchema,
	parseLlmJson,
} from "@/utils"
import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import type { DomiaType } from "@/modules/core"
import type {
	ChatMessageType,
	ToolCallOrReplyType,
	ToolDefinitionType,
} from "@/modules/llm-engine"
import { sanitizeJsonSchema } from "@/modules/llm-engine"
import {
	callTool,
	resolveSkillArgs,
	resolveToolFinalize,
	renderFinalizeText,
	getToolPolicy,
	getInvocationPolicy,
	getToolMeta,
	getProviderResilience,
	type SkillCallResultType,
} from "@/modules/skill-engine"
import {
	parkConfirmation,
	confirmationScope,
	summarizeConfirmAction,
	createToolGuards,
	callSignature,
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
	AgentStopReasonType,
	AgentTurnOptionsType,
	AsyncToolOutcomeType,
} from "../types"

const ABORTED = Symbol("agent-aborted")

const TOOL_RESULT_COMPACT_CAP = 240
const COMPACT_SUFFIX = " …[truncated]"

const mapSkillStatus = (
	status: SkillCallResultType["status"],
): ToolRunStatusType =>
	status === "ok"
		? "ok"
		: status === "timeout"
			? "timeout"
			: status === "cancelled"
				? "cancelled"
				: "failed"

const skillErrorCode = (
	status: SkillCallResultType["status"],
): ToolResultErrorCodeType | undefined =>
	status === "ok" || status === "cancelled" ? undefined : status

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

const normalizeToolName = (name: string, known: Set<string>): string | null => {
	const stripped = name.replace(/^(functions|tools)[./:]/, "")
	if (known.has(stripped)) return stripped
	const lower = stripped.toLowerCase()
	const ciMatches = [...known].filter((k) => k.toLowerCase() === lower)
	if (ciMatches.length === 1) return ciMatches[0]
	const suffixMatches = [...known].filter((k) =>
		k.toLowerCase().endsWith(`${SKILL_TOOL_NAME_SEPARATOR}${lower}`),
	)
	if (suffixMatches.length === 1) return suffixMatches[0]
	return null
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
		return `### TOOLS (highest priority)\n${SKILLS_CLAUSE}\n\n${persona}`
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
	const advertisedTools =
		opts?.canConfirm === false
			? tools.filter(
					(t) => getToolPolicy(domia.id, t.namespacedName) !== "confirm",
				)
			: tools
	const toolDefs = toToolDefs(advertisedTools)
	const system = buildAgentSystem(domia, transcript)
	const userContent = opts?.recentToolsLine
		? `${transcript}\n[Recently: ${opts.recentToolsLine}]`
		: transcript
	const messages: ChatMessageType[] = [
		{ role: "system", content: system },
		{ role: "user", content: userContent },
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
		advertisedTools.map((t) => {
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
		advertisedTools.map((t) => {
			const req = t.inputSchema?.required
			return [t.namespacedName, Array.isArray(req) ? req.map(String) : []]
		}),
	)
	const argCorrected = new Set<string>()
	const knownToolNames = new Set(toolDefs.map((t) => t.name))
	const toolSchemas = new Map<string, Record<string, unknown>>(
		advertisedTools.map((t) => [t.namespacedName, t.inputSchema]),
	)
	const guards = createToolGuards({
		repeatWarnAt:
			domia.llmModelConfig?.agentRepeatWarnAt ?? DEFAULT_AGENT_REPEAT_WARN_AT,
		repeatBlockAt:
			domia.llmModelConfig?.agentRepeatBlockAt ?? DEFAULT_AGENT_REPEAT_BLOCK_AT,
		maxCallsPerTurn:
			domia.llmModelConfig?.agentMaxToolCallsPerTurn ??
			DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN,
	})
	const doneReason = (): AgentStopReasonType =>
		guards.wasCapTripped() ? "call_cap" : "completed"
	let forceNoTool = false
	let taintedByOpenWorld = false

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
				const pendingFinalize = streamFinalize(
					messages,
					toolDefs,
					undefined,
					effectiveSignal,
				)
				const res = await raceAbort(pendingFinalize, effectiveSignal)
				if (res === ABORTED) {
					void pendingFinalize
						.then((r) => {
							if (r.kind === "reply") r.close()
						})
						.catch(() => undefined)
					return abortedReturn(step)
				}
				if (res.kind === "reply") {
					return {
						reply: "",
						replyStream: res.tokens,
						replyStreamClose: res.close,
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
					inference(
						messages,
						toolDefs,
						noTool ? "none" : undefined,
						effectiveSignal,
					),
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
				stopReason: doneReason(),
			}
		}

		decisionMs += inferMs
		messages.push({ role: "assistant", content: "", toolCalls: out.calls })
		const authoredSay = out.say?.trim() || null
		let sayEligible = false

		let confirmTarget: {
			call: (typeof out.calls)[number]
			confirmArgs: Record<string, unknown>
			resolvedArgs: Record<string, unknown>
			resolutionFailed: boolean
		} | null = null

		const templateParts: string[] = []
		let allTemplate = true
		const callMessages: (string | null)[] = out.calls.map(() => null)
		const toRun: {
			idx: number
			call: (typeof out.calls)[number]
			safeArgs: Record<string, unknown>
		}[] = []
		for (let ci = 0; ci < out.calls.length; ci++) {
			const call = out.calls[ci]
			if (call.argsInvalid) {
				allTemplate = false
				callMessages[ci] =
					`Error: the arguments for "${call.name}" were not valid JSON. Call it again with well-formed JSON arguments.`
				agentLogger.warn("agent tool call had unparseable args — rejected", {
					domiaId: domia.id,
					name: call.name,
				})
				continue
			}
			if (!call.name.trim() || call.name === "__blank__") {
				allTemplate = false
				callMessages[ci] =
					`Do not echo tool-call syntax from earlier content. Answer the user directly in plain language.`
				agentLogger.warn("agent emitted a blank tool name — anti-priming", {
					domiaId: domia.id,
				})
				continue
			}
			if (!knownToolNames.has(call.name)) {
				const normalized = normalizeToolName(call.name, knownToolNames)
				if (normalized) {
					call.name = normalized
				} else {
					allTemplate = false
					callMessages[ci] =
						`Error: no tool named "${call.name}" exists. Available tools: ${[...knownToolNames].join(", ")}. Pick one of these or reply without a tool.`
					agentLogger.warn("agent called unknown tool — corrected", {
						domiaId: domia.id,
						name: call.name,
					})
					continue
				}
			}
			const safeArgs = coerceArgsToSchema(
				pruneEmptyArgs(
					filterToAllowed(call.arguments, allowedParams.get(call.name)),
				),
				toolSchemas.get(call.name),
			)
			call.arguments = safeArgs
			let missing = (requiredParams.get(call.name) ?? []).filter(
				(k) => safeArgs[k] === undefined,
			)
			if (
				missing.length > 0 &&
				opts?.constrainedRepair &&
				(domia.llmModelConfig?.constrainedRepairEnabled ??
					DEFAULT_CONSTRAINED_REPAIR_ENABLED) &&
				!argCorrected.has(call.name)
			) {
				const schema = sanitizeJsonSchema(toolSchemas.get(call.name) ?? {})
				if (schema) {
					const raw = await opts
						.constrainedRepair(
							`Produce JSON arguments for the tool "${call.name}" to satisfy this request: "${transcript}". The model previously sent ${JSON.stringify(safeArgs)} which is missing: ${missing.join(", ")}. Respond with a single JSON object.`,
							schema,
						)
						.catch(() => null)
					if (raw) {
						const { value } = parseLlmJson(raw)
						if (value) {
							const repaired = coerceArgsToSchema(
								pruneEmptyArgs(
									filterToAllowed(
										{ ...safeArgs, ...value },
										allowedParams.get(call.name),
									),
								),
								toolSchemas.get(call.name),
							)
							const stillMissing = (requiredParams.get(call.name) ?? []).filter(
								(k) => repaired[k] === undefined,
							)
							if (stillMissing.length === 0) {
								agentLogger.info("constrained repair filled missing args", {
									domiaId: domia.id,
									name: call.name,
								})
								Object.assign(safeArgs, repaired)
								call.arguments = safeArgs
								missing = []
							}
						}
					}
				}
			}
			if (missing.length > 0) {
				allTemplate = false
				const retry = argCorrected.has(call.name)
				argCorrected.add(call.name)
				if (retry) forceNoTool = true
				callMessages[ci] = retry
					? `Error: "${call.name}" is still missing required argument(s): ${missing.join(", ")}. Do not call it again — tell the user you need ${missing.join(" and ")}.`
					: `Error: "${call.name}" is missing required argument(s): ${missing.join(", ")}. You sent ${JSON.stringify(safeArgs)}. Call "${call.name}" again with ${missing.join(" and ")} filled in.`
				agentLogger.warn("agent tool call missing required args", {
					domiaId: domia.id,
					name: call.name,
					missing,
					retry,
				})
				continue
			}
			const key = callSignature(call.name, safeArgs)
			if (toRun.some((r) => callSignature(r.call.name, r.safeArgs) === key)) {
				callMessages[ci] =
					`Duplicate of a call already in this batch — executed once.`
				continue
			}
			const basePolicy = getToolPolicy(domia.id, call.name)
			if (basePolicy === "block") {
				allTemplate = false
				callMessages[ci] =
					`Action "${call.name}" is blocked by policy and was not run. Tell the user this action is not allowed.`
				agentLogger.warn("agent tool call rejected — policy block", {
					domiaId: domia.id,
					name: call.name,
				})
				continue
			}
			{
				const callMeta = getToolMeta(domia.id, call.name)
				let needsConfirm = basePolicy === "confirm"
				let resolution: {
					ok: boolean
					resolvedArgs: Record<string, unknown>
				} | null = null
				if (needsConfirm) {
					resolution = await resolveSkillArgs(domia.id, call.name, safeArgs)
				} else if (
					taintedByOpenWorld &&
					callMeta &&
					callMeta.riskClass !== "read"
				) {
					resolution = await resolveSkillArgs(domia.id, call.name, safeArgs)
					needsConfirm = true
					agentLogger.warn(
						"open-world taint — write escalated to confirmation",
						{ domiaId: domia.id, name: call.name },
					)
				} else {
					const resolved = await resolveSkillArgs(domia.id, call.name, safeArgs)
					if (
						resolved.ok &&
						getInvocationPolicy(domia.id, call.name, resolved.resolvedArgs)
							.policy === "confirm"
					) {
						resolution = resolved
						needsConfirm = true
					}
				}
				if (needsConfirm) {
					confirmTarget = {
						call,
						confirmArgs: safeArgs,
						resolvedArgs: resolution?.resolvedArgs ?? safeArgs,
						resolutionFailed: resolution ? !resolution.ok : false,
					}
					break
				}
			}
			const verdict = guards.onCallAttempt(call.name, safeArgs)
			if (verdict.action === "block") {
				allTemplate = false
				callMessages[ci] = verdict.syntheticResult ?? "Call blocked."
				if (verdict.forceNoTool) forceNoTool = true
				agentLogger.warn("agent tool call blocked by guard", {
					domiaId: domia.id,
					name: call.name,
				})
				continue
			}
			toRun.push({ idx: ci, call, safeArgs })
		}
		if (confirmTarget) {
			const confirmCall = confirmTarget.call
			const droppedSiblings = out.calls
				.filter((c) => c !== confirmCall)
				.map((c) => c.name)
			const language = domia.characterProfile?.language ?? null
			const confirmArgs = confirmTarget.confirmArgs
			const resolution = {
				ok: !confirmTarget.resolutionFailed,
				resolvedArgs: confirmTarget.resolvedArgs,
			}
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

		for (const { call } of toRun) {
			toolNamesUsed.push(call.name)
			const sepIdx = call.name.indexOf(SKILL_TOOL_NAME_SEPARATOR)
			if (sepIdx > 0) serversUsed.add(call.name.slice(0, sepIdx))
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
			const allAsync =
				opts?.allowAsyncTools === true &&
				toRun.every(
					({ call }) =>
						resolveToolFinalize(domia.id, call.name)?.mode === "async",
				)
			if (allAsync) {
				const pendingTools: Promise<AsyncToolOutcomeType>[] = []
				const ackParts: string[] = []
				const phrases = languageSetsFor(
					domia.characterProfile?.language,
				).phrases
				for (const { call, safeArgs } of toRun) {
					const rule = resolveToolFinalize(domia.id, call.name)
					ackParts.push(rule?.ack ?? phrases.onIt)
					skillResponses.push({
						kind: "dispatched",
						tool: call.name,
						args: safeArgs,
					})
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
					`agent async tools dispatched (${toRun.length}) — respond-first`,
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
			sayEligible =
				toRun.length > 0 &&
				settled.every((s) => s.result.status === "ok" && !s.result.isError)
			const phrases = languageSetsFor(domia.characterProfile?.language).phrases
			for (let i = 0; i < toRun.length; i++) {
				const { idx, call, safeArgs } = toRun[i]
				const { result } = settled[i]
				const entry = toToolTraceEntry(
					call.name,
					result,
					settled[i].ms,
					safeArgs,
				)
				skillResponses.push(entry)
				emitToolResult(call.name, mapSkillStatus(result.status), settled[i].ms)
				const meta = getToolMeta(domia.id, call.name)
				if (meta?.openWorld && result.status === "ok") taintedByOpenWorld = true
				guards.onResult(
					call.name,
					safeArgs,
					result.status === "ok" && !result.isError,
					result.text,
					meta?.idempotent === true || meta?.riskClass === "read",
				)
				const guarded = wrapUntrustedToolOutput(call.name, result.text)
				if (guarded.flagged) {
					agentLogger.warn("tool output flagged by injection guard", {
						domiaId: domia.id,
						name: call.name,
						reasons: guarded.reasons,
					})
				}
				callMessages[idx] = guarded.text
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
		for (let ci = 0; ci < out.calls.length; ci++) {
			messages.push({
				role: "tool",
				toolName: out.calls[ci].name,
				content: callMessages[ci] ?? "(no result)",
			})
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
		if (
			domia.llmModelConfig?.authoredSpeechEnabled === true &&
			sayEligible &&
			authoredSay
		) {
			return {
				reply: authoredSay,
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "authored",
				stopReason: doneReason(),
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

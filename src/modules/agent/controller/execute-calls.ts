import {
	DEFAULT_SLOW_TOOL_AFTER_MS,
	DEFAULT_AGENT_ACK_AFTER_MS,
	SKILL_TOOL_NAME_SEPARATOR,
} from "@/db"
import { wrapUntrustedToolOutput, agentLogger } from "@/utils"
import {
	callTool,
	resolveToolFinalize,
	renderFinalizeText,
	getToolMeta,
	getProviderResilience,
} from "@/modules/skill-engine"

import type {
	AgentTurnContextType,
	ScreenedCallType,
	ToolExecutionOutcomeType,
	ToolRunOutcomeType,
} from "../types"
import {
	ABORTED,
	mapSkillStatus,
	toToolTraceEntry,
	providerOf,
	emitToolRequested,
	emitToolResult,
	raceAbort,
} from "./helpers"
import { abortedOutcome } from "./result"
import { dispatchAllAsync, deadlineAck } from "./respond-first"

const idemKey = (name: string, args: Record<string, unknown>): string =>
	`${name}:${JSON.stringify(args)}`

const runToolOnce = async (
	ctx: AgentTurnContextType,
	name: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolRunOutcomeType> => {
	const idempotent =
		getProviderResilience(ctx.domia.id, providerOf(name) ?? "")
			?.idempotentWithinTurn === true
	const key = idempotent ? idemKey(name, args) : null
	if (key) {
		const cached = ctx.idemCache.get(key)
		if (cached) return cached
	}
	const started = process.hrtime.bigint()
	try {
		const result = await callTool(ctx.domia.id, name, args, signal)
		const out = {
			result,
			ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
		}
		if (key && result.status === "ok" && !result.isError)
			ctx.idemCache.set(key, out)
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

const markCancelled = (
	ctx: AgentTurnContextType,
	toRun: ScreenedCallType[],
): void => {
	for (const { call, safeArgs } of toRun) {
		ctx.skillResponses.push({
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

const recordSettledResults = (
	ctx: AgentTurnContextType,
	toRun: ScreenedCallType[],
	settled: ToolRunOutcomeType[],
	callMessages: (string | null)[],
): { templateParts: string[]; allTemplate: boolean } => {
	const templateParts: string[] = []
	let allTemplate = true
	const phrases = ctx.languageSets.phrases
	for (let i = 0; i < toRun.length; i++) {
		const { idx, call, safeArgs } = toRun[i]
		const { result } = settled[i]
		const entry = toToolTraceEntry(call.name, result, settled[i].ms, safeArgs)
		ctx.skillResponses.push(entry)
		emitToolResult(call.name, mapSkillStatus(result.status), settled[i].ms)
		const meta = getToolMeta(ctx.domia.id, call.name)
		if (meta?.openWorld && result.status === "ok") ctx.taintedByOpenWorld = true
		ctx.guards.onResult(
			call.name,
			safeArgs,
			result.status === "ok" && !result.isError,
			result.text,
			meta?.idempotent === true || meta?.riskClass === "read",
		)
		const guarded = wrapUntrustedToolOutput(call.name, result.text)
		if (guarded.flagged) {
			agentLogger.warn("tool output flagged by injection guard", {
				domiaId: ctx.domia.id,
				name: call.name,
				reasons: guarded.reasons,
			})
		}
		callMessages[idx] = guarded.text
		const rule = resolveToolFinalize(ctx.domia.id, call.name)
		if (rule?.mode === "template" || rule?.mode === "deadline") {
			const ok = result.status === "ok" && !result.isError
			const template = ok
				? rule.mode === "deadline"
					? (rule.done ?? rule.ack)
					: rule.ack
				: rule.error
			const fallback = ok ? phrases.done : phrases.cantDoThat
			const rendered = template
				? (renderFinalizeText(
						template,
						safeArgs,
						result.resolvedArgs,
						result.speakableText,
					) ?? fallback)
				: fallback
			templateParts.push(rendered)
			if (entry.kind === "result") entry.displaySummary = rendered
		} else {
			allTemplate = false
		}
	}
	return { templateParts, allTemplate }
}

export const executeToolCalls = async (
	ctx: AgentTurnContextType,
	step: number,
	toRun: ScreenedCallType[],
	callMessages: (string | null)[],
): Promise<ToolExecutionOutcomeType> => {
	for (const { call } of toRun) {
		ctx.toolNamesUsed.push(call.name)
		const sepIdx = call.name.indexOf(SKILL_TOOL_NAME_SEPARATOR)
		if (sepIdx > 0) ctx.serversUsed.add(call.name.slice(0, sepIdx))
		emitToolRequested(call.name)
	}
	if (toRun.length === 0)
		return {
			kind: "settled",
			templateParts: [],
			allTemplate: true,
			sayEligible: false,
		}
	const allAsync =
		ctx.opts?.allowAsyncTools === true &&
		toRun.every(
			({ call }) =>
				resolveToolFinalize(ctx.domia.id, call.name)?.mode === "async",
		)
	if (allAsync)
		return {
			kind: "respond_first",
			outcome: dispatchAllAsync(ctx, step, toRun),
		}
	const allDeadline =
		ctx.opts?.allowAsyncTools === true &&
		toRun.every(
			({ call }) =>
				resolveToolFinalize(ctx.domia.id, call.name)?.mode === "deadline",
		)
	let slowTimer: ReturnType<typeof setTimeout> | null = null
	if (ctx.opts?.onSlowTool && !allDeadline) {
		slowTimer = setTimeout(
			ctx.opts.onSlowTool,
			ctx.opts.slowToolAfterMs ?? DEFAULT_SLOW_TOOL_AFTER_MS,
		)
		slowTimer.unref()
	}
	const running = toRun.map((p) =>
		runToolOnce(
			ctx,
			p.call.name,
			p.safeArgs,
			allDeadline ? undefined : ctx.effectiveSignal,
		),
	)
	let settled: ToolRunOutcomeType[]
	if (allDeadline) {
		const ackAfterMs = Math.min(
			...toRun.map(
				({ call }) =>
					resolveToolFinalize(ctx.domia.id, call.name)?.ackAfterMs ??
					ctx.domia.llmModelConfig?.agentAckAfterMs ??
					DEFAULT_AGENT_ACK_AFTER_MS,
			),
		)
		let deadlineTimer = null as ReturnType<typeof setTimeout> | null
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
			ctx.effectiveSignal,
		)
		if (deadlineTimer) clearTimeout(deadlineTimer)
		if (raced === ABORTED) {
			markCancelled(ctx, toRun)
			return { kind: "aborted", outcome: abortedOutcome(ctx, step) }
		}
		if (raced.deadline)
			return {
				kind: "respond_first",
				outcome: deadlineAck(ctx, step, toRun, running, ackAfterMs),
			}
		settled = raced.settled
	} else {
		const awaited = await raceAbort(Promise.all(running), ctx.effectiveSignal)
		if (slowTimer) clearTimeout(slowTimer)
		if (awaited === ABORTED) {
			markCancelled(ctx, toRun)
			return { kind: "aborted", outcome: abortedOutcome(ctx, step) }
		}
		settled = awaited
	}
	ctx.toolMs += settled.reduce((m, s) => Math.max(m, s.ms), 0)
	const sayEligible = settled.every(
		(s) => s.result.status === "ok" && !s.result.isError,
	)
	const recorded = recordSettledResults(ctx, toRun, settled, callMessages)
	return {
		kind: "settled",
		templateParts: recorded.templateParts,
		allTemplate: recorded.allTemplate,
		sayEligible,
	}
}

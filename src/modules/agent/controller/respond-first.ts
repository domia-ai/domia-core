import { agentLogger } from "@/utils"
import {
	resolveToolFinalize,
	renderFinalizeText,
	callTool,
} from "@/modules/skill-engine"

import type {
	AgentStepOutcomeType,
	AgentTurnContextType,
	AsyncToolOutcomeType,
	ScreenedCallType,
	ToolRunOutcomeType,
} from "../types"
import { replyOutcome } from "./result"

const ackOutcome = (
	ctx: AgentTurnContextType,
	step: number,
	ackParts: string[],
	pendingTools: Promise<AsyncToolOutcomeType>[],
): AgentStepOutcomeType =>
	replyOutcome(ctx, step, {
		reply: [...new Set(ackParts)].join(" "),
		finalizeMode: "template",
		pendingTools,
	})

export const dispatchAllAsync = (
	ctx: AgentTurnContextType,
	step: number,
	toRun: ScreenedCallType[],
): AgentStepOutcomeType => {
	const pendingTools: Promise<AsyncToolOutcomeType>[] = []
	const ackParts: string[] = []
	const phrases = ctx.languageSets.phrases
	for (const { call, safeArgs } of toRun) {
		const rule = resolveToolFinalize(ctx.domia.id, call.name)
		ackParts.push(rule?.ack ?? phrases.onIt)
		ctx.skillResponses.push({
			kind: "dispatched",
			tool: call.name,
			args: safeArgs,
		})
		pendingTools.push(
			callTool(ctx.domia.id, call.name, safeArgs)
				.then((result) => {
					const ok = result.status === "ok" && !result.isError
					const template = ok ? rule?.done : rule?.error
					const fallback = ok ? phrases.thatIsDone : phrases.cantDoThat
					return {
						tool: call.name,
						ok,
						doneText: template
							? (renderFinalizeText(
									template,
									safeArgs,
									result.resolvedArgs,
									result.speakableText,
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
							: phrases.cantDoThat,
				})),
		)
	}
	agentLogger.info(
		`agent async tools dispatched (${toRun.length}) — respond-first`,
		{ domiaId: ctx.domia.id, tools: toRun.map((p) => p.call.name) },
	)
	return ackOutcome(ctx, step, ackParts, pendingTools)
}

export const deadlineAck = (
	ctx: AgentTurnContextType,
	step: number,
	toRun: ScreenedCallType[],
	running: Promise<ToolRunOutcomeType>[],
	ackAfterMs: number,
): AgentStepOutcomeType => {
	const phrases = ctx.languageSets.phrases
	const ackParts: string[] = []
	const pendingTools: Promise<AsyncToolOutcomeType>[] = []
	for (let i = 0; i < toRun.length; i++) {
		const { call, safeArgs } = toRun[i]
		const rule = resolveToolFinalize(ctx.domia.id, call.name)
		ackParts.push(rule?.ack ?? phrases.onIt)
		ctx.skillResponses.push({
			kind: "dispatched",
			tool: call.name,
			args: safeArgs,
		})
		pendingTools.push(
			running[i].then(({ result }) => {
				const ok = result.status === "ok" && !result.isError
				const template = ok ? rule?.done : rule?.error
				const fallback = ok ? phrases.thatIsDone : phrases.cantDoThat
				return {
					tool: call.name,
					ok,
					doneText: template
						? (renderFinalizeText(
								template,
								safeArgs,
								result.resolvedArgs,
								result.speakableText,
							) ?? fallback)
						: fallback,
					resolvedArgs: result.resolvedArgs,
				}
			}),
		)
	}
	agentLogger.info(
		`agent deadline ack (${toRun.length}) — respond-first after ${ackAfterMs}ms`,
		{ domiaId: ctx.domia.id, tools: toRun.map((p) => p.call.name) },
	)
	return ackOutcome(ctx, step, ackParts, pendingTools)
}

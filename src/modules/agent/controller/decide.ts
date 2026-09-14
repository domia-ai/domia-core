import { isDomiaError, AGENT_ERRORS, agentLogger } from "@/utils"
import type { ToolCallOrReplyType } from "@/modules/llm-engine"

import {
	READ_BEFORE_ANSWER_NUDGE,
	AGENT_FAILURE_REPLY,
	AGENT_ACTED_FAILURE_REPLY,
} from "../constants"
import { looksLikeToolCallJson } from "../utils"
import type { AgentDecisionOutcomeType, AgentTurnContextType } from "../types"
import { ABORTED, raceAbort } from "./helpers"
import { abortedOutcome, doneReason, replyOutcome } from "./result"

export const decideNextAction = async (
	ctx: AgentTurnContextType,
	step: number,
): Promise<AgentDecisionOutcomeType> => {
	let out: ToolCallOrReplyType
	const noTool = ctx.forceNoTool || step === ctx.maxSteps - 1
	const roundToolDefs = ctx.readOnlyRound ? ctx.readToolDefs : ctx.toolDefs
	ctx.readOnlyRound = false
	const streamFinalize =
		ctx.opts?.voice &&
		ctx.opts.streamFinalize &&
		ctx.toolNamesUsed.length > 0 &&
		!noTool
			? ctx.opts.streamFinalize
			: null
	const injectedRetry = ctx.retryCall !== null && step === 0
	const inferStart = process.hrtime.bigint()
	try {
		if (ctx.retryCall && step === 0) {
			out = {
				kind: "tool_calls",
				calls: [
					{ name: ctx.retryCall.tool, arguments: { ...ctx.retryCall.args } },
				],
			}
			agentLogger.info("retry cue — re-issuing the last tool call", {
				domiaId: ctx.domia.id,
				name: ctx.retryCall.tool,
			})
		} else if (streamFinalize) {
			const pendingFinalize = streamFinalize(
				ctx.messages,
				roundToolDefs,
				undefined,
				ctx.effectiveSignal,
			)
			const res = await raceAbort(pendingFinalize, ctx.effectiveSignal)
			if (res === ABORTED) {
				void pendingFinalize
					.then((r) => {
						if (r.kind === "reply") r.close()
					})
					.catch(() => undefined)
				return { kind: "aborted", outcome: abortedOutcome(ctx, step) }
			}
			if (res.kind === "reply")
				return {
					kind: "stop",
					outcome: replyOutcome(ctx, step, {
						replyStream: res.tokens,
						replyStreamClose: res.close,
						finalizeMode: "streamed",
					}),
				}
			out = { kind: "tool_calls", calls: res.calls }
		} else {
			const inferred = await raceAbort(
				ctx.inference(
					ctx.messages,
					roundToolDefs,
					noTool ? "none" : undefined,
					ctx.effectiveSignal,
				),
				ctx.effectiveSignal,
			)
			if (inferred === ABORTED)
				return { kind: "aborted", outcome: abortedOutcome(ctx, step) }
			out = inferred
		}
	} catch (err) {
		const nonRetriableDecision =
			isDomiaError(err) &&
			(err.code === AGENT_ERRORS.DECISION_UNPARSEABLE.code ||
				err.code === AGENT_ERRORS.DECISION_UNAVAILABLE.code)
		if (ctx.toolNamesUsed.length === 0) {
			if (!nonRetriableDecision) throw err
			agentLogger.warn(
				"agent inference failed before any tool ran — replying honestly",
				{ domiaId: ctx.domia.id, err },
			)
			return {
				kind: "stop",
				outcome: replyOutcome(ctx, step, {
					reply: ctx.languageSets.phrases.cantDoThat,
					stopReason: "inference_error",
				}),
			}
		}
		agentLogger.warn(
			"agent inference failed after a tool ran — not falling back",
			{ domiaId: ctx.domia.id, toolNamesUsed: ctx.toolNamesUsed, err },
		)
		return {
			kind: "stop",
			outcome: replyOutcome(ctx, step, {
				reply: AGENT_ACTED_FAILURE_REPLY,
				stopReason: "tool_error",
			}),
		}
	}
	const inferMs = Math.round(Number(process.hrtime.bigint() - inferStart) / 1e6)

	if (out.kind === "reply") {
		if (
			ctx.interrogative &&
			!noTool &&
			ctx.toolNamesUsed.length === 0 &&
			!ctx.readOnlyRetried &&
			ctx.readToolDefs.length > 0
		) {
			ctx.decisionMs += inferMs
			ctx.readOnlyRetried = true
			ctx.readOnlyRound = true
			ctx.messages.push({ role: "user", content: READ_BEFORE_ANSWER_NUDGE })
			agentLogger.warn(
				"answer without a read for a question — retrying read-only",
				{
					domiaId: ctx.domia.id,
				},
			)
			return { kind: "stop", outcome: { kind: "continue" } }
		}
		ctx.finalizeMs += inferMs
		const spokeToolCall = looksLikeToolCallJson(out.text)
		if (spokeToolCall)
			agentLogger.warn("agent reply was a tool-call JSON — suppressed", {
				domiaId: ctx.domia.id,
			})
		return {
			kind: "stop",
			outcome: replyOutcome(ctx, step, {
				reply: spokeToolCall ? AGENT_FAILURE_REPLY : out.text,
				stopReason: doneReason(ctx),
			}),
		}
	}

	ctx.decisionMs += inferMs
	return {
		kind: "tool_calls",
		calls: out.calls,
		authoredSay: out.say?.trim() || null,
		injectedRetry,
	}
}

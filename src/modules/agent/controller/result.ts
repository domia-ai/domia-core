import { agentLogger } from "@/utils"

import { AGENT_FAILURE_REPLY, AGENT_ACTED_FAILURE_REPLY } from "../constants"
import type {
	AgentResultPatchType,
	AgentResultType,
	AgentStepOutcomeType,
	AgentStopReasonType,
	AgentTurnContextType,
} from "../types"
import { estimateTokens } from "./helpers"

export const doneReason = (ctx: AgentTurnContextType): AgentStopReasonType =>
	ctx.guards.wasCapTripped() ? "call_cap" : "completed"

export const failureReply = (ctx: AgentTurnContextType): string =>
	ctx.toolNamesUsed.length > 0 ? AGENT_ACTED_FAILURE_REPLY : AGENT_FAILURE_REPLY

export const turnResult = (
	ctx: AgentTurnContextType,
	step: number,
	patch: AgentResultPatchType,
): AgentResultType => ({
	reply: patch.reply ?? "",
	replyStream: patch.replyStream,
	replyStreamClose: patch.replyStreamClose,
	toolNamesUsed: ctx.toolNamesUsed,
	serversUsed: [...ctx.serversUsed],
	steps: patch.steps ?? step + 1,
	skillPrompt: ctx.system,
	skillResponses: ctx.skillResponses,
	decisionMs: ctx.decisionMs,
	toolMs: ctx.toolMs,
	finalizeMs: ctx.finalizeMs,
	finalizeMode: patch.finalizeMode ?? "agent_loop",
	stopReason: patch.stopReason ?? "completed",
	pendingTools: patch.pendingTools,
})

export const replyOutcome = (
	ctx: AgentTurnContextType,
	step: number,
	patch: AgentResultPatchType,
): AgentStepOutcomeType => ({
	kind: "reply",
	result: turnResult(ctx, step, patch),
})

export const confirmOutcome = (
	ctx: AgentTurnContextType,
	step: number,
	patch: AgentResultPatchType,
): AgentStepOutcomeType => ({
	kind: "confirm_required",
	result: turnResult(ctx, step, { ...patch, stopReason: "confirm_required" }),
})

export const abortedOutcome = (
	ctx: AgentTurnContextType,
	step: number,
): AgentStepOutcomeType => ({
	kind: "aborted",
	result: turnResult(ctx, step, { stopReason: "aborted" }),
})

export const overflowOutcome = (
	ctx: AgentTurnContextType,
	step: number,
): AgentStepOutcomeType => {
	agentLogger.warn("agent context overflow — compaction insufficient", {
		domiaId: ctx.domia.id,
		step,
		tokens: estimateTokens(ctx.messages),
		budget: ctx.tokenBudget,
	})
	return replyOutcome(ctx, step, {
		reply: failureReply(ctx),
		stopReason: "context_overflow",
	})
}

import type { AgentStepOutcomeType, AgentTurnContextType } from "../types"
import { compactWithinBudget } from "./helpers"
import { decideNextAction } from "./decide"
import { executeToolCalls } from "./execute-calls"
import {
	appendToolMessages,
	applyReadThenAnswer,
	authoredReply,
	templateReply,
} from "./finalize"
import { parkConfirmTarget } from "./park-confirmation"
import { screenToolCalls } from "./screen-calls"
import { abortedOutcome, overflowOutcome } from "./result"

export const runAgentStep = async (
	ctx: AgentTurnContextType,
	step: number,
): Promise<AgentStepOutcomeType> => {
	if (ctx.effectiveSignal?.aborted) return abortedOutcome(ctx, step)
	if (!compactWithinBudget(ctx.messages, ctx.tokenBudget))
		return overflowOutcome(ctx, step)
	const decision = await decideNextAction(ctx, step)
	if (decision.kind !== "tool_calls") return decision.outcome
	const { calls, authoredSay, injectedRetry } = decision
	const screened = await screenToolCalls(ctx, calls, injectedRetry)
	const { toRun, callMessages, confirmTarget } = screened
	if (confirmTarget) return parkConfirmTarget(ctx, step, confirmTarget, calls)
	const execution = await executeToolCalls(ctx, step, toRun, callMessages)
	if (execution.kind !== "settled") return execution.outcome
	appendToolMessages(ctx, calls, callMessages)
	applyReadThenAnswer(ctx, toRun)
	return (
		templateReply(
			ctx,
			step,
			screened.allTemplate && execution.allTemplate,
			execution.templateParts,
		) ??
		authoredReply(ctx, step, execution.sayEligible, authoredSay) ?? {
			kind: "continue",
		}
	)
}

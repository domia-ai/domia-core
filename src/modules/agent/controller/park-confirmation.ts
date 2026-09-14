import { DEFAULT_CONFIRMATION_TTL_MS } from "@/db"
import type { ToolCallType } from "@/modules/llm-engine"

import {
	parkConfirmation,
	confirmationScope,
	summarizeConfirmAction,
} from "../utils"
import type {
	AgentStepOutcomeType,
	AgentTurnContextType,
	ConfirmTargetType,
} from "../types"
import { confirmOutcome, replyOutcome } from "./result"

export const parkConfirmTarget = (
	ctx: AgentTurnContextType,
	step: number,
	target: ConfirmTargetType,
	calls: ToolCallType[],
): AgentStepOutcomeType => {
	const confirmCall = target.call
	const droppedSiblings = calls
		.filter((c) => c !== confirmCall)
		.map((c) => c.name)
	if (target.resolutionFailed)
		return replyOutcome(ctx, step, {
			reply: ctx.languageSets.phrases.cantDoThat,
		})
	const summary = summarizeConfirmAction(
		ctx.domia.id,
		confirmCall.name,
		target.resolvedArgs,
		ctx.language,
	)
	parkConfirmation(
		confirmationScope(ctx.domia.domiaKey, ctx.opts?.confirmationChannel),
		{
			tool: confirmCall.name,
			args: target.confirmArgs,
			resolvedArgs: target.resolvedArgs,
			language: ctx.language,
			summary,
		},
		ctx.domia.llmModelConfig?.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS,
	)
	const confirmPhrase = ctx.languageSets.phrases.confirmAction
	const siblingNote =
		droppedSiblings.length > 0
			? ` I'll hold off on the rest until you confirm.`
			: ""
	return confirmOutcome(ctx, step, {
		reply: summary
			? `${summary} ${confirmPhrase}${siblingNote}`
			: `${confirmPhrase}${siblingNote}`,
	})
}

import { agentLogger } from "@/utils"
import type { ToolCallType } from "@/modules/llm-engine"

import type {
	AgentStepOutcomeType,
	AgentTurnContextType,
	ScreenedCallType,
} from "../types"
import { isReadTool } from "./context"
import { failureReply, replyOutcome, turnResult, doneReason } from "./result"

export const appendToolMessages = (
	ctx: AgentTurnContextType,
	calls: ToolCallType[],
	callMessages: (string | null)[],
): void => {
	ctx.messages.push({
		role: "assistant",
		content: "",
		toolCalls: calls.map((c) => ({
			...c,
			name: ctx.aliasMap.aliasOf(c.name),
		})),
	})
	for (let ci = 0; ci < calls.length; ci++) {
		ctx.messages.push({
			role: "tool",
			toolName: ctx.aliasMap.aliasOf(calls[ci].name),
			content: callMessages[ci] ?? "(no result)",
		})
	}
}

export const applyReadThenAnswer = (
	ctx: AgentTurnContextType,
	toRun: ScreenedCallType[],
): void => {
	if (
		ctx.readThenAnswer &&
		ctx.interrogative &&
		toRun.length > 0 &&
		toRun.every((r) => isReadTool(ctx.domia.id, r.call.name))
	)
		ctx.forceNoTool = true
}

export const templateReply = (
	ctx: AgentTurnContextType,
	step: number,
	allTemplate: boolean,
	templateParts: string[],
): AgentStepOutcomeType | null =>
	allTemplate && templateParts.length > 0
		? replyOutcome(ctx, step, {
				reply: templateParts.join(" "),
				finalizeMode: "template",
			})
		: null

export const authoredReply = (
	ctx: AgentTurnContextType,
	step: number,
	sayEligible: boolean,
	authoredSay: string | null,
): AgentStepOutcomeType | null =>
	ctx.domia.llmModelConfig?.authoredSpeechEnabled === true &&
	sayEligible &&
	authoredSay
		? replyOutcome(ctx, step, {
				reply: authoredSay,
				finalizeMode: "authored",
				stopReason: doneReason(ctx),
			})
		: null

export const exhaustedOutcome = (
	ctx: AgentTurnContextType,
): Extract<AgentStepOutcomeType, { kind: "exhausted" }> => {
	agentLogger.warn("agent loop exhausted max steps", {
		domiaId: ctx.domia.id,
		toolNamesUsed: ctx.toolNamesUsed,
	})
	return {
		kind: "exhausted",
		result: turnResult(ctx, ctx.maxSteps - 1, {
			reply: failureReply(ctx),
			steps: ctx.maxSteps,
			stopReason: "max_steps",
		}),
	}
}

import type { SkillToolType } from "@/db"
import type { DomiaType } from "@/modules/core"

import type {
	AgentInferenceType,
	AgentResultType,
	AgentTurnOptionsType,
} from "../types"
import { createTurnContext } from "./context"
import { exhaustedOutcome } from "./finalize"
import { runAgentStep } from "./step"

export const runAgentTurn = async (
	domia: DomiaType,
	transcript: string,
	tools: SkillToolType[],
	inference: AgentInferenceType,
	opts?: AgentTurnOptionsType,
): Promise<AgentResultType> => {
	const ctx = createTurnContext(domia, transcript, tools, inference, opts)
	for (let step = 0; step < ctx.maxSteps; step++) {
		const outcome = await runAgentStep(ctx, step)
		if (outcome.kind !== "continue") return outcome.result
	}
	return exhaustedOutcome(ctx).result
}

import { INTENT_DECISION_ENUM, type IntentDecisionHeadType } from "@/db"

import type { ReflectionFlagsType, TurnKindType } from "../types"

export const FACT_USER_GROUNDING_MIN_OVERLAP = 0.5

export const REFLECTION_PRIORITY_CONCURRENCY = 1
export const REFLECTION_PRIORITY_QUEUE_MAX_DEPTH = 4

export const TURN_KIND_ENUM = {
	CONVERSATION: "conversation",
	FAST_PATH: "fast_path",
	TOOL: "tool",
	MEMORY_WRITE: "memory_write",
	CONFIRMATION: "confirmation",
	CLARIFICATION: "clarification",
	ACKNOWLEDGEMENT: "acknowledgement",
} as const
export const TURN_KIND_ENUM_VALUES = [
	TURN_KIND_ENUM.CONVERSATION,
	TURN_KIND_ENUM.FAST_PATH,
	TURN_KIND_ENUM.TOOL,
	TURN_KIND_ENUM.MEMORY_WRITE,
	TURN_KIND_ENUM.CONFIRMATION,
	TURN_KIND_ENUM.CLARIFICATION,
	TURN_KIND_ENUM.ACKNOWLEDGEMENT,
] as const

export const TURN_KIND_BY_INTENT: Record<IntentDecisionHeadType, TurnKindType> =
	{
		[INTENT_DECISION_ENUM.FAST_PATH]: TURN_KIND_ENUM.FAST_PATH,
		[INTENT_DECISION_ENUM.CLARIFY]: TURN_KIND_ENUM.CLARIFICATION,
		[INTENT_DECISION_ENUM.CONFIRMATION]: TURN_KIND_ENUM.CONFIRMATION,
		[INTENT_DECISION_ENUM.ELICIT_ANSWER]: TURN_KIND_ENUM.CONFIRMATION,
		[INTENT_DECISION_ENUM.SKILL]: TURN_KIND_ENUM.TOOL,
		[INTENT_DECISION_ENUM.CHAT]: TURN_KIND_ENUM.CONVERSATION,
	}

export const REFLECTION_CAPTURE_BY_TURN_KIND: Record<
	TurnKindType,
	ReflectionFlagsType
> = {
	[TURN_KIND_ENUM.CONVERSATION]: { emotion: true, facts: true },
	[TURN_KIND_ENUM.FAST_PATH]: { emotion: false, facts: false },
	[TURN_KIND_ENUM.TOOL]: { emotion: false, facts: false },
	[TURN_KIND_ENUM.MEMORY_WRITE]: { emotion: false, facts: true },
	[TURN_KIND_ENUM.CONFIRMATION]: { emotion: false, facts: false },
	[TURN_KIND_ENUM.CLARIFICATION]: { emotion: false, facts: false },
	[TURN_KIND_ENUM.ACKNOWLEDGEMENT]: { emotion: false, facts: false },
}

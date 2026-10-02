import {
	INTENT_DECISION_ENUM_VALUES,
	TOOL_RUN_STATUS_ENUM,
	type IntentDecisionHeadType,
	type ToolTraceEntryType,
} from "@/db"
import { DOMIA_FACT_WRITE_TOOLS } from "@/modules/skill-engine/specializations/domia/constants"
import { languageSetsFor } from "@/utils/language-catalogs"

import {
	TURN_KIND_ENUM,
	TURN_KIND_BY_INTENT,
	REFLECTION_CAPTURE_BY_TURN_KIND,
} from "../constants"
import type { ReflectionFlagsType, TurnKindType, TurnTraceType } from "../types"

const INTENT_HEAD_RE = /^[a-z-]+/

const intentHeadOf = (
	intentDecision: string | null | undefined,
): IntentDecisionHeadType | null => {
	const head = intentDecision?.trim().match(INTENT_HEAD_RE)?.[0]
	return INTENT_DECISION_ENUM_VALUES.find((value) => value === head) ?? null
}

const isBareReply = (userText: string, language?: string | null): boolean => {
	const normalized = userText
		.trim()
		.toLowerCase()
		.replace(/[.,!¡¿?]/g, "")
		.replace(/\s+/g, " ")
	if (!normalized) return false
	const sets = languageSetsFor(language ?? null)
	return sets.affirmations.has(normalized) || sets.negations.has(normalized)
}

const namesTool = (entry: unknown): entry is { tool: string } =>
	typeof entry === "object" &&
	entry !== null &&
	"tool" in entry &&
	typeof entry.tool === "string"

const isOkResult = (
	entry: unknown,
): entry is Extract<ToolTraceEntryType, { kind: "result" }> =>
	typeof entry === "object" &&
	entry !== null &&
	"kind" in entry &&
	entry.kind === "result" &&
	"status" in entry &&
	entry.status === TOOL_RUN_STATUS_ENUM.OK

const isMemoryWriteTurn = (
	trace: TurnTraceType | null | undefined,
): boolean => {
	const toolEntries = (trace?.skillResponse ?? []).filter(namesTool)
	return (
		toolEntries.length > 0 &&
		toolEntries.every(
			(entry) => isOkResult(entry) && DOMIA_FACT_WRITE_TOOLS.has(entry.tool),
		)
	)
}

export const turnKindOf = (
	trace: TurnTraceType | null | undefined,
	userText: string,
	language?: string | null,
): TurnKindType => {
	const head = intentHeadOf(trace?.intentDecision)
	const routed = head ? TURN_KIND_BY_INTENT[head] : TURN_KIND_ENUM.CONVERSATION
	if (routed !== TURN_KIND_ENUM.CONVERSATION && routed !== TURN_KIND_ENUM.TOOL)
		return routed
	if (isMemoryWriteTurn(trace)) return TURN_KIND_ENUM.MEMORY_WRITE
	const acted =
		(trace?.toolCallCount ?? 0) > 0 || (trace?.skillResponse?.length ?? 0) > 0
	if (acted) return TURN_KIND_ENUM.TOOL
	if (isBareReply(userText, language)) return TURN_KIND_ENUM.ACKNOWLEDGEMENT
	return TURN_KIND_ENUM.CONVERSATION
}

export const captureFlagsFor = (
	enabled: ReflectionFlagsType,
	kind: TurnKindType,
): ReflectionFlagsType => {
	const capture = REFLECTION_CAPTURE_BY_TURN_KIND[kind]
	return {
		emotion: enabled.emotion && capture.emotion,
		facts: enabled.facts && capture.facts,
	}
}

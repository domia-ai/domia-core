import {
	SKILL_TRUST_TIER_ENUM,
	HINT_SOURCE_ENUM,
	type ToolAnnotationsType,
	type ToolHintOverrideType,
	type ToolPolicyType,
	type ToolRiskClassType,
} from "@/db"
import type { EffectiveHintsType, HintSourceType } from "../types"

const RISK_ORDER: Record<ToolRiskClassType, number> = {
	read: 0,
	write_additive: 1,
	write_destructive: 2,
}

const annotationsHonored = (trustTier: string): boolean =>
	trustTier === SKILL_TRUST_TIER_ENUM.TRUSTED

const resolveHint = (
	server: boolean | undefined,
	override: boolean | undefined,
	honorAll: boolean,
	riskIncreasingValue: boolean,
): { value: boolean | undefined; source: HintSourceType } => {
	if (override !== undefined)
		return { value: override, source: HINT_SOURCE_ENUM.DESCRIPTOR }
	if (server === undefined)
		return { value: undefined, source: HINT_SOURCE_ENUM.DEFAULT }
	if (honorAll || server === riskIncreasingValue)
		return { value: server, source: HINT_SOURCE_ENUM.ANNOTATION }
	return { value: undefined, source: HINT_SOURCE_ENUM.DEFAULT }
}

export const effectiveHints = (
	annotations: ToolAnnotationsType | undefined,
	override: ToolHintOverrideType | undefined,
	trustTier: string,
): EffectiveHintsType => {
	const honorAll = annotationsHonored(trustTier)
	const readOnly = resolveHint(
		annotations?.readOnlyHint,
		override?.readOnlyHint,
		honorAll,
		false,
	)
	const destructive = resolveHint(
		annotations?.destructiveHint,
		override?.destructiveHint,
		honorAll,
		true,
	)
	const idempotent = resolveHint(
		annotations?.idempotentHint,
		override?.idempotentHint,
		honorAll,
		false,
	)
	const openWorld = resolveHint(
		annotations?.openWorldHint,
		override?.openWorldHint,
		honorAll,
		true,
	)
	return {
		readOnly: readOnly.value,
		destructive: destructive.value,
		idempotent: idempotent.value,
		openWorld: openWorld.value,
		sources: {
			readOnly: readOnly.source,
			destructive: destructive.source,
			idempotent: idempotent.source,
			openWorld: openWorld.source,
		},
	}
}

export const deriveRiskClass = (
	hints: EffectiveHintsType,
): ToolRiskClassType => {
	if (hints.readOnly === true) return "read"
	if (hints.destructive === false) return "write_additive"
	return "write_destructive"
}

export const deriveDefaultPolicy = (risk: ToolRiskClassType): ToolPolicyType =>
	risk === "write_destructive" ? "confirm" : "allow"

export const escalateRisk = (
	base: ToolRiskClassType,
	invocation: ToolRiskClassType | null,
): ToolRiskClassType =>
	invocation && RISK_ORDER[invocation] > RISK_ORDER[base] ? invocation : base

export const escalatePolicy = (
	base: ToolPolicyType,
	risk: ToolRiskClassType,
): ToolPolicyType =>
	base === "allow" && risk === "write_destructive" ? "confirm" : base

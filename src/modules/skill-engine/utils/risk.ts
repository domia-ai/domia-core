import {
	SKILL_TRUST_TIER_ENUM,
	type ToolAnnotationsType,
	type ToolHintOverrideType,
	type ToolPolicyType,
	type ToolRiskClassType,
} from "@/db"
import type { EffectiveHintsType } from "../types"

const RISK_ORDER: Record<ToolRiskClassType, number> = {
	read: 0,
	write_additive: 1,
	write_destructive: 2,
}

const resolveHint = (
	server: boolean | undefined,
	override: boolean | undefined,
	trusted: boolean,
	riskIncreasingValue: boolean,
): boolean | undefined => {
	if (override !== undefined) return override
	if (trusted) return server
	return server === riskIncreasingValue ? server : undefined
}

export const effectiveHints = (
	annotations: ToolAnnotationsType | undefined,
	override: ToolHintOverrideType | undefined,
	trustTier: string,
): EffectiveHintsType => {
	const trusted = trustTier === SKILL_TRUST_TIER_ENUM.TRUSTED
	return {
		readOnly: resolveHint(
			annotations?.readOnlyHint,
			override?.readOnlyHint,
			trusted,
			false,
		),
		destructive: resolveHint(
			annotations?.destructiveHint,
			override?.destructiveHint,
			trusted,
			true,
		),
		idempotent: resolveHint(
			annotations?.idempotentHint,
			override?.idempotentHint,
			trusted,
			false,
		),
		openWorld: resolveHint(
			annotations?.openWorldHint,
			override?.openWorldHint,
			trusted,
			true,
		),
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

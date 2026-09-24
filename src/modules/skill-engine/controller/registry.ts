import {
	SKILL_TOOL_NAME_SEPARATOR,
	type SkillToolType,
	type ToolHintOverrideType,
	type ToolPolicyType,
} from "@/db"
import { skillEngineLogger, hashCanonical } from "@/utils"

import dbAdapter from "../db-adapter"
import {
	describeConnectionInvocation,
	inferConnectionWriteTarget,
} from "../utils/invocation"
import {
	effectiveHints,
	deriveRiskClass,
	deriveDefaultPolicy,
	escalateRisk,
	escalatePolicy,
} from "../utils/risk"
import { toolBaseName } from "../utils"
import type {
	SkillConnectionType,
	ResolvedSkillResilienceType,
	ResolvedSkillDescriptorType,
	ResolvedToolMetaType,
	ToolInvocationDescriptionType,
	ToolTargetInferenceType,
	OriginCapabilitiesType,
} from "../types"

import { connections } from "./state"

const findConn = (
	domiaId: string,
	providerSlug: string,
): SkillConnectionType | undefined =>
	[...connections.values()].find(
		(c) => c.provider.domiaId === domiaId && c.providerSlug === providerSlug,
	)

export const getProviderResilience = (
	domiaId: string,
	providerSlug: string,
): ResolvedSkillResilienceType | null =>
	findConn(domiaId, providerSlug)?.descriptor.resilience ?? null

const splitName = (
	namespacedName: string,
): { providerSlug: string; rawName: string } => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	return {
		providerSlug: sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : "",
		rawName:
			sepIdx >= 0
				? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
				: namespacedName,
	}
}

const declaredFor = <T>(
	declared: Record<string, T>,
	rawName: string,
): T | undefined => {
	for (const key of [rawName, toolBaseName(rawName), "*"])
		if (key in declared) return declared[key]
	return undefined
}

export const declaredToolPolicy = (
	descriptor: ResolvedSkillDescriptorType,
	rawName: string,
): ToolPolicyType | undefined => declaredFor(descriptor.toolPolicy, rawName)

const declaredToolHint = (
	descriptor: ResolvedSkillDescriptorType,
	rawName: string,
): ToolHintOverrideType | undefined =>
	declaredFor(descriptor.toolHints, rawName)

export const buildToolMeta = (
	tools: SkillToolType[],
	descriptor: ResolvedSkillDescriptorType,
	trustTier: string,
): Map<string, ResolvedToolMetaType> => {
	const meta = new Map<string, ResolvedToolMetaType>()
	for (const t of tools) {
		const override = declaredToolHint(descriptor, t.rawName)
		const hints = effectiveHints(t.annotations, override, trustTier)
		const riskClass = deriveRiskClass(hints)
		const declaredPolicy = declaredToolPolicy(descriptor, t.rawName)
		meta.set(t.rawName, {
			rawName: t.rawName,
			riskClass,
			idempotent: hints.idempotent === true,
			openWorld: hints.openWorld !== false,
			cancellable: override?.cancellable ?? true,
			policy:
				declaredPolicy ?? deriveDefaultPolicy(riskClass, hints, trustTier),
			policySource: declaredPolicy ? "descriptor" : "risk_default",
			hintSources: hints.sources,
			timeoutMs: override?.timeoutMs ?? null,
			allowedActors: null,
		})
	}
	return meta
}

export const getToolPolicy = (
	domiaId: string,
	namespacedName: string,
): ToolPolicyType => {
	const { providerSlug, rawName } = splitName(namespacedName)
	const conn = findConn(domiaId, providerSlug)
	if (!conn) return "allow"
	return (
		conn.toolMeta.get(rawName)?.policy ??
		declaredToolPolicy(conn.descriptor, rawName) ??
		"allow"
	)
}

export const getToolMeta = (
	domiaId: string,
	namespacedName: string,
): ResolvedToolMetaType | null => {
	const { providerSlug, rawName } = splitName(namespacedName)
	return findConn(domiaId, providerSlug)?.toolMeta.get(rawName) ?? null
}

export const specializationKindOf = (
	domiaId: string,
	providerSlug: string,
): string | null =>
	findConn(domiaId, providerSlug)?.specialization?.kind ?? null

export const getConnectionsFor = (domiaId: string): SkillConnectionType[] =>
	[...connections.values()].filter((c) => c.provider.domiaId === domiaId)

export const toolAvailableFor = (
	domiaId: string,
	namespacedName: string,
	origin: OriginCapabilitiesType,
): boolean => {
	const { providerSlug, rawName } = splitName(namespacedName)
	const conn = findConn(domiaId, providerSlug)
	if (!conn?.specialization?.toolAvailability) return true
	return conn.specialization.toolAvailability(conn.provider, rawName, origin)
}

export const claimToolRunSpoken = (
	interactionId: string,
	namespacedName: string,
	resolvedArgs: Record<string, unknown> | undefined,
): boolean => {
	const runId = `${interactionId}:${namespacedName}:${hashCanonical(resolvedArgs ?? {})}:0`
	try {
		return dbAdapter.claimSpoken(runId)
	} catch (error) {
		skillEngineLogger.warn("tool_run spoken claim failed", { runId, error })
		return true
	}
}

export const unclaimToolRunSpoken = (
	interactionId: string,
	namespacedName: string,
	resolvedArgs: Record<string, unknown> | undefined,
): void => {
	const runId = `${interactionId}:${namespacedName}:${hashCanonical(resolvedArgs ?? {})}:0`
	try {
		dbAdapter.unclaimSpoken(runId).run()
	} catch (error) {
		skillEngineLogger.warn("tool_run spoken unclaim failed", { runId, error })
	}
}

export const markDispatchedToolRunsLost = (): void => {
	try {
		dbAdapter.markLostDispatched().run()
	} catch (error) {
		skillEngineLogger.warn("tool_run lost sweep failed", { error })
	}
}

export const describeInvocation = (
	domiaId: string,
	namespacedName: string,
	args: Record<string, unknown>,
	language?: string | null,
): ToolInvocationDescriptionType => {
	const { providerSlug, rawName } = splitName(namespacedName)
	return describeConnectionInvocation(
		findConn(domiaId, providerSlug),
		rawName,
		args,
		language,
	)
}

export const inferWriteTarget = (
	domiaId: string,
	namespacedName: string,
	args: Record<string, unknown>,
	transcript: string,
	language?: string | null,
): ToolTargetInferenceType => {
	const { providerSlug, rawName } = splitName(namespacedName)
	return inferConnectionWriteTarget(
		findConn(domiaId, providerSlug),
		rawName,
		args,
		transcript,
		language,
	)
}

export const getInvocationPolicy = (
	domiaId: string,
	namespacedName: string,
	resolvedArgs: Record<string, unknown>,
): { policy: ToolPolicyType; escalated: boolean } => {
	const { providerSlug, rawName } = splitName(namespacedName)
	const conn = findConn(domiaId, providerSlug)
	if (!conn) return { policy: "allow", escalated: false }
	const meta = conn.toolMeta.get(rawName)
	const basePolicy =
		meta?.policy ?? declaredToolPolicy(conn.descriptor, rawName) ?? "allow"
	if (!conn.specialization?.invocationRisk || !meta)
		return { policy: basePolicy, escalated: false }
	const invocation = conn.specialization.invocationRisk(
		conn.provider,
		rawName,
		resolvedArgs,
	)
	const risk = escalateRisk(meta.riskClass, invocation)
	const policy =
		meta.policySource === "risk_default"
			? escalatePolicy(basePolicy, risk)
			: basePolicy
	return { policy, escalated: policy !== basePolicy }
}

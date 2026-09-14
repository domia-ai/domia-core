import { desc, eq, and, isNotNull } from "drizzle-orm"

import {
	dbClient,
	interactionTrace,
	DEFAULT_AGENT_RECENT_TOOLS_TURNS,
	DEFAULT_ANAPHORA_MAX_AGE_MS,
	type ToolTraceEntryType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import type { AgentRetryCallType } from "@/modules/agent"
import {
	describeInvocation,
	specializationKindOf,
	toolBaseName,
	toolProviderSlug,
} from "@/modules/skill-engine"

import type { LastActedEntityType } from "../types"

const MAX_LINE_CHARS = 120

const traceAgeMs = (createdAt: string): number => {
	const ms = Date.now() - new Date(`${createdAt.replace(" ", "T")}Z`).getTime()
	return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

const agoLabel = (createdAt: string): string => {
	const ms = traceAgeMs(createdAt)
	if (!Number.isFinite(ms) || ms < 0) return "just now"
	const s = Math.round(ms / 1000)
	if (s < 90) return `${s}s ago`
	return `${Math.round(s / 60)}m ago`
}

const renderEntry = (
	domia: DomiaType,
	entry: ToolTraceEntryType,
	createdAt: string,
): string | null => {
	if (entry.kind !== "result" && entry.kind !== "async_outcome") return null
	if (entry.status !== "ok") return null
	const args = entry.resolvedArgs ?? ("args" in entry ? entry.args : undefined)
	const target = describeInvocation(
		domia.id,
		entry.tool,
		args ?? {},
		domia.characterProfile?.language,
	).target
	const shortName = toolBaseName(entry.tool)
	const targetPart = typeof target === "string" ? ` → ${target}` : ""
	return `${shortName}${targetPart} ok · ${agoLabel(createdAt)}`
}

const clarifiedEntities = new Map<
	string,
	{ name: string; providerSlug: string | null; at: number }
>()

export const setClarifiedEntity = (
	domiaId: string,
	name: string,
	providerSlug: string | null,
): void => {
	clarifiedEntities.set(domiaId, { name, providerSlug, at: Date.now() })
}

export const clearClarifiedEntity = (domiaId: string): void => {
	clarifiedEntities.delete(domiaId)
}

const actedEntityOf = (
	domiaId: string,
	entity: string,
	namespacedName: string,
): LastActedEntityType => {
	const providerSlug = toolProviderSlug(namespacedName)
	return {
		entity,
		providerSlug,
		kind: providerSlug ? specializationKindOf(domiaId, providerSlug) : null,
	}
}

const clarifiedEntityOf = (
	domiaId: string,
	clarified: { name: string; providerSlug: string | null },
): LastActedEntityType => ({
	entity: clarified.name,
	providerSlug: clarified.providerSlug,
	kind: clarified.providerSlug
		? specializationKindOf(domiaId, clarified.providerSlug)
		: null,
})

export const lastActedEntity = async (
	domia: DomiaType,
): Promise<LastActedEntityType | null> => {
	const maxAgeMs =
		domia.llmModelConfig?.anaphoraMaxAgeMs ?? DEFAULT_ANAPHORA_MAX_AGE_MS
	const clarified = clarifiedEntities.get(domia.id)
	const liveClarified =
		clarified && Date.now() - clarified.at <= maxAgeMs ? clarified : null
	const rows = await dbClient
		.select({
			skillResponse: interactionTrace.skillResponse,
			createdAt: interactionTrace.createdAt,
		})
		.from(interactionTrace)
		.where(
			and(
				eq(interactionTrace.domiaId, domia.id),
				isNotNull(interactionTrace.skillResponse),
			),
		)
		.orderBy(desc(interactionTrace.createdAt))
		.limit(3)
	for (const row of rows) {
		if (traceAgeMs(row.createdAt) > maxAgeMs) break
		const entries = row.skillResponse ?? []
		for (const entry of [...entries].reverse()) {
			if (entry.kind !== "result" && entry.kind !== "async_outcome") continue
			if (entry.status !== "ok") continue
			const target = describeInvocation(
				domia.id,
				entry.tool,
				entry.resolvedArgs ?? {},
				domia.characterProfile?.language,
			).target
			if (target) {
				const actedAt = Date.now() - traceAgeMs(row.createdAt)
				if (liveClarified && liveClarified.at > actedAt)
					return clarifiedEntityOf(domia.id, liveClarified)
				return actedEntityOf(domia.id, target, entry.tool)
			}
		}
	}
	return liveClarified ? clarifiedEntityOf(domia.id, liveClarified) : null
}

export const lastToolCall = async (
	domia: DomiaType,
): Promise<AgentRetryCallType | null> => {
	const turns =
		domia.llmModelConfig?.agentRecentToolsTurns ??
		DEFAULT_AGENT_RECENT_TOOLS_TURNS
	if (turns <= 0) return null
	const maxAgeMs =
		domia.llmModelConfig?.anaphoraMaxAgeMs ?? DEFAULT_ANAPHORA_MAX_AGE_MS
	const rows = await dbClient
		.select({
			skillResponse: interactionTrace.skillResponse,
			createdAt: interactionTrace.createdAt,
		})
		.from(interactionTrace)
		.where(
			and(
				eq(interactionTrace.domiaId, domia.id),
				isNotNull(interactionTrace.skillResponse),
			),
		)
		.orderBy(desc(interactionTrace.createdAt))
		.limit(turns)
	let lastExecuted: AgentRetryCallType | null = null
	for (const row of rows) {
		if (traceAgeMs(row.createdAt) > maxAgeMs) break
		for (const entry of [...(row.skillResponse ?? [])].reverse()) {
			if (entry.kind !== "result") continue
			if (entry.status !== "ok" && entry.status !== "failed") continue
			const call = {
				tool: entry.tool,
				args: entry.args ?? entry.resolvedArgs ?? {},
			}
			if (entry.status === "failed") return call
			lastExecuted = lastExecuted ?? call
		}
	}
	return lastExecuted
}

export const recentToolsLine = async (
	domia: DomiaType,
): Promise<string | null> => {
	const turns =
		domia.llmModelConfig?.agentRecentToolsTurns ??
		DEFAULT_AGENT_RECENT_TOOLS_TURNS
	if (turns <= 0) return null
	const rows = await dbClient
		.select({
			skillResponse: interactionTrace.skillResponse,
			createdAt: interactionTrace.createdAt,
		})
		.from(interactionTrace)
		.where(
			and(
				eq(interactionTrace.domiaId, domia.id),
				isNotNull(interactionTrace.skillResponse),
			),
		)
		.orderBy(desc(interactionTrace.createdAt))
		.limit(turns)
	const parts: string[] = []
	for (const row of rows) {
		const entries = row.skillResponse ?? []
		for (const entry of entries) {
			const rendered = renderEntry(domia, entry, row.createdAt)
			if (rendered) parts.push(rendered)
		}
	}
	if (parts.length === 0) return null
	let line = parts.join(" · ")
	if (line.length > MAX_LINE_CHARS) line = `${line.slice(0, MAX_LINE_CHARS)}…`
	return line
}

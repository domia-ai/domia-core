import { desc, eq, and, isNotNull } from "drizzle-orm"

import {
	dbClient,
	interactionTrace,
	DEFAULT_AGENT_RECENT_TOOLS_TURNS,
	DEFAULT_ANAPHORA_MAX_AGE_MS,
	type ToolTraceEntryType,
} from "@/db"
import type { DomiaType } from "@/modules/core"

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
	entry: ToolTraceEntryType,
	createdAt: string,
): string | null => {
	if (entry.kind !== "result" && entry.kind !== "async_outcome") return null
	if (entry.status !== "ok") return null
	const args = entry.resolvedArgs ?? ("args" in entry ? entry.args : undefined)
	const target =
		args && typeof args === "object"
			? ((args as Record<string, unknown>).name ??
				(args as Record<string, unknown>).area)
			: undefined
	const shortName = entry.tool.includes("__")
		? entry.tool.slice(entry.tool.indexOf("__") + 2)
		: entry.tool
	const targetPart = typeof target === "string" ? `(${target})` : ""
	return `${shortName}${targetPart} ok · ${agoLabel(createdAt)}`
}

const clarifiedEntities = new Map<string, { name: string; at: number }>()

export const setClarifiedEntity = (domiaId: string, name: string): void => {
	clarifiedEntities.set(domiaId, { name, at: Date.now() })
}

export const clearClarifiedEntity = (domiaId: string): void => {
	clarifiedEntities.delete(domiaId)
}

export const lastActedEntity = async (
	domia: DomiaType,
): Promise<string | null> => {
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
		const entries = (row.skillResponse ?? []) as ToolTraceEntryType[]
		for (const entry of [...entries].reverse()) {
			if (entry.kind !== "result" && entry.kind !== "async_outcome") continue
			if (entry.status !== "ok") continue
			const name = entry.resolvedArgs?.name
			if (typeof name === "string" && name.trim()) {
				const actedAt = Date.now() - traceAgeMs(row.createdAt)
				if (liveClarified && liveClarified.at > actedAt)
					return liveClarified.name
				return name
			}
		}
	}
	return liveClarified?.name ?? null
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
		const entries = (row.skillResponse ?? []) as ToolTraceEntryType[]
		for (const entry of entries) {
			const rendered = renderEntry(entry, row.createdAt)
			if (rendered) parts.push(rendered)
		}
	}
	if (parts.length === 0) return null
	let line = parts.join(" · ")
	if (line.length > MAX_LINE_CHARS) line = `${line.slice(0, MAX_LINE_CHARS)}…`
	return line
}

import { type DomiaType } from "@/modules/core"
import { generateUuid } from "@/utils"

import {
	DBClientOrTxType,
	UpdateInteractionTraceType,
	type InsertAnnouncementType,
} from "@/db"
import type { RecentTurnType } from "@/modules/prompt-context-builder"
import dbAdapter from "../db-adapter"
import { RECENT_TURNS_WINDOW, RECENT_TURNS_MAX_AGE_MS } from "../constants"
import type {
	NewInteractionDataType,
	LatencyPercentilesType,
	LatencyStatsType,
} from "../types"

const percentiles = (values: number[]): LatencyPercentilesType => {
	const v = values
		.filter((n) => Number.isFinite(n) && n > 0)
		.sort((a, b) => a - b)
	if (v.length === 0)
		return { count: 0, p50: null, p90: null, min: null, max: null }
	const at = (q: number) =>
		v[Math.min(v.length - 1, Math.round(q * (v.length - 1)))]
	return {
		count: v.length,
		p50: at(0.5),
		p90: at(0.9),
		min: v[0],
		max: v[v.length - 1],
	}
}

export const getLatencyStats = async (
	domia: DomiaType,
	limit = 100,
): Promise<LatencyStatsType> => {
	const rows = await dbAdapter.getRecentInteractionsForDomia(domia.id, limit)
	const ok = rows.filter((r) => r.status === "ok")
	const bySatellite: Record<string, LatencyPercentilesType> = {}
	const satIds = [
		...new Set(ok.map((r) => r.satelliteId).filter((s): s is string => !!s)),
	]
	for (const id of satIds) {
		bySatellite[id] = percentiles(
			ok.filter((r) => r.satelliteId === id).map((r) => r.ttfaMs ?? 0),
		)
	}
	return {
		sampleSize: ok.length,
		ttfa: percentiles(ok.map((r) => r.ttfaMs ?? 0)),
		perceivedTtfa: percentiles(ok.map((r) => r.perceivedTtfaMs ?? 0)),
		stt: percentiles(ok.map((r) => r.sttMs ?? 0)),
		llm: percentiles(ok.map((r) => r.llmMs ?? 0)),
		tts: percentiles(ok.map((r) => r.ttsMs ?? 0)),
		bySatellite,
	}
}

const pipelineStarts = new Map<string, number>()

export const markPipelineStart = (interactionId: string): void => {
	if (pipelineStarts.size > 256) {
		const oldest = pipelineStarts.keys().next().value
		if (oldest) pipelineStarts.delete(oldest)
	}
	if (!pipelineStarts.has(interactionId)) {
		pipelineStarts.set(interactionId, Date.now())
	}
}

export const pipelineElapsed = (interactionId: string): number | undefined => {
	const start = pipelineStarts.get(interactionId)
	return start == null ? undefined : Date.now() - start
}

export const getInteractionsSince = (
	domiaId: string,
	since: string,
	limit: number,
) => dbAdapter.getInteractionsSince(domiaId, since, limit)

export const getSessionsSince = (
	domiaId: string,
	since: string,
	limit: number,
) => dbAdapter.getSessionsSince(domiaId, since, limit)

export const recordAnnouncement = (data: InsertAnnouncementType) =>
	dbAdapter.insertAnnouncement(data)

export const getAnnouncementById = (id: string) =>
	dbAdapter.getAnnouncementById(id)

export const getAnnouncementsSince = (
	domiaId: string,
	since: string,
	limit: number,
) => dbAdapter.getAnnouncementsSince(domiaId, since, limit)

export const getLastInteractionAt = async (domiaId: string) => {
	const row = await dbAdapter.getLastInteractionAt(domiaId)
	return row?.updatedAt ?? null
}

export const getLastAnnouncementAt = async (domiaId: string) => {
	const row = await dbAdapter.getLastAnnouncementAt(domiaId)
	return row?.updatedAt ?? null
}

export const getOrCreateSessionForDomia = async (domia: DomiaType) => {
	const now = Date.now()
	const domiaId = domia?.id
	const timeoutMs = domia?.sessionIdTimeoutMs ?? 300_000

	const [existingSession] =
		await dbAdapter.getExistingInteractionSessionTrace(domiaId)
	const lastUsedAt = existingSession?.lastUsedAt
		? new Date(existingSession.lastUsedAt + "Z").getTime()
		: null
	const expired = lastUsedAt !== null ? now - lastUsedAt > timeoutMs : true
	if (existingSession && !expired) {
		await dbAdapter.updateInteractionSessionTrace(existingSession)

		return {
			interactionSessionTraceId: existingSession.id,
			sessionId: existingSession.sessionId,
		}
	}

	const newId = generateUuid()
	const newSessionId = generateUuid()

	await dbAdapter.insertInteractionSessionTrace({
		id: newId,
		sessionId: newSessionId,
		domiaId,
	})

	return {
		interactionSessionTraceId: newId,
		sessionId: newSessionId,
	}
}

const buildDomiaSnapshot = (domia: DomiaType) => ({
	emotion: domia.emotionState ?? null,
	character: domia.characterProfile ?? null,
	stt: domia.sttConfig ?? null,
	llm: domia.llmModelConfig ?? null,
	tts: domia.ttsConfig ?? null,
	wakeWord: domia.wakeWordConfig ?? null,
	modules: domia.moduleSettings ?? null,
	capabilities: domia.runtimeCapabilities ?? null,
})

const buildUsedDiscriminators = (domia: DomiaType) => ({
	sttModelUsed: domia.sttConfig?.modelName ?? null,
	llmModelUsed: domia.llmModelConfig?.modelName ?? null,
	ttsEngineUsed: domia.ttsConfig?.engine ?? null,
	ttsVoiceUsed: domia.ttsConfig?.voiceName ?? null,
	wakeWordModelUsed: domia.wakeWordConfig?.model ?? null,
})

export const registerNewInteraction = async (
	domia: DomiaType,
	data: NewInteractionDataType,
	client?: DBClientOrTxType,
	idOverride?: string,
) => {
	const interactionId = idOverride ?? generateUuid()

	const { interactionSessionTraceId, sessionId } =
		await getOrCreateSessionForDomia(domia)

	await dbAdapter.insertInteractionTrace(
		{
			domiaSnapshot: buildDomiaSnapshot(domia),
			...buildUsedDiscriminators(domia),
			...data,
			id: interactionId,
			domiaId: domia.id,
			interactionSessionTraceId,
			sessionId,
		},
		client,
	)

	return {
		interactionId,
		interactionSessionTraceId,
		sessionId,
		domiaId: domia.id,
	}
}

export const getOrCreateInteractionId = async (
	domia: DomiaType,
	existingInteractionId: string | undefined,
	defaultData: NewInteractionDataType,
	client?: DBClientOrTxType,
): Promise<string | null> => {
	if (existingInteractionId) {
		const existing = await getInteractionById(existingInteractionId, client)
		if (existing) return existingInteractionId
		try {
			await registerNewInteraction(
				domia,
				defaultData,
				client,
				existingInteractionId,
			)
		} catch {
			// row may have been created concurrently — fall through
		}
		return existingInteractionId
	}
	try {
		const { interactionId } = await registerNewInteraction(
			domia,
			defaultData,
			client,
		)
		return interactionId
	} catch {
		return null
	}
}

export const updateInteraction = async (
	data: UpdateInteractionTraceType,
	client?: DBClientOrTxType,
) => {
	await dbAdapter.updateInteractionTrace(data, client)
}

export const getInteractionById = async (
	interactionId: string,
	client?: DBClientOrTxType,
) => {
	const rows = await dbAdapter.getInteractionById(interactionId, client)
	return rows
}

export const getRecentUserMoods = async (
	domia: DomiaType,
	limit: number = RECENT_TURNS_WINDOW,
): Promise<string[]> => {
	try {
		const rows = await dbAdapter.getRecentInteractionsForDomia(
			domia.id,
			limit * 3,
		)
		const now = Date.now()
		const maxAgeMs = domia?.memoryMaxAgeMs ?? RECENT_TURNS_MAX_AGE_MS
		return rows
			.filter((row) => {
				const ts = row.createdAt ? Date.parse(row.createdAt + "Z") : NaN
				return !Number.isNaN(ts) && now - ts <= maxAgeMs
			})
			.map((row) => row.userEmotionSnapshot)
			.filter(
				(s): s is { primary: string; intensity?: number; note?: string } =>
					!!s &&
					typeof s === "object" &&
					typeof (s as { primary?: unknown }).primary === "string",
			)
			.map((s) => (s.note ? `${s.primary} (${s.note})` : s.primary))
			.slice(0, limit)
			.reverse()
	} catch {
		return []
	}
}

export const getRecentTurns = async (
	domia: DomiaType,
	excludeInteractionId: string | undefined,
): Promise<RecentTurnType[]> => {
	try {
		const limit = domia?.memoryWindowTurns ?? RECENT_TURNS_WINDOW
		if (limit <= 0) return []
		const maxAgeMs = domia?.memoryMaxAgeMs ?? RECENT_TURNS_MAX_AGE_MS
		const rows = await dbAdapter.getRecentInteractionsForDomia(
			domia.id,
			limit * 3,
		)
		const now = Date.now()
		return rows
			.filter((row) => row.id !== excludeInteractionId)
			.filter((row) => {
				const ts = row.createdAt ? Date.parse(row.createdAt + "Z") : NaN
				return !Number.isNaN(ts) && now - ts <= maxAgeMs
			})
			.map((row) => ({
				userText: row.inputRaw ?? row.sttResult ?? null,
				domiaText:
					row.heardReply === ""
						? null
						: (row.heardReply ?? row.llmResponse ?? row.finalOutput ?? null),
				createdAt: row.createdAt,
			}))
			.filter((turn) => turn.userText && turn.domiaText)
			.slice(0, limit)
			.reverse()
	} catch {
		return []
	}
}

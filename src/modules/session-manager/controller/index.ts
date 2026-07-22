import { type DomiaType } from "@/modules/core"
import { generateUuid, memoryLogger, parseLlmJson } from "@/utils"
import { runLLMJson } from "@/modules/llm-engine"
import { activeVoiceReplies } from "@/modules/voice-admission"
import { recordEpisode, patchUserModel } from "@/modules/memory"

import {
	DBClientOrTxType,
	UpdateInteractionTraceType,
	INTERACTION_INPUT_TYPE_ENUM,
	type InsertAnnouncementType,
	type InsertTurnEventType,
	type SelectInteractionTraceType,
	type ImplicitFeedbackType,
} from "@/db"
import {
	emitTurnEvent,
	DOMIA_TURN_EVENT_ENUM,
	type DomiaTurnEventType,
	type TurnEventInputSourceType,
} from "@/buses"
import type { RecentTurnType } from "@/modules/prompt-context-builder"
import dbAdapter from "../db-adapter"
import {
	RECENT_TURNS_WINDOW,
	RECENT_TURNS_MAX_AGE_MS,
	SUMMARIZE_IDLE_POLL_MS,
	SUMMARIZE_MAX_IDLE_WAIT_MS,
} from "../constants"
import { sessionSummarySchema } from "../schemas"
import type {
	NewInteractionDataType,
	LatencyPercentilesType,
	LatencyStatsType,
	RecentTurnsAndMoodsType,
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
		llmQueue: percentiles(ok.map((r) => r.llmQueueMs ?? 0)),
		tts: percentiles(ok.map((r) => r.ttsMs ?? 0)),
		ttsFirstChunk: percentiles(ok.map((r) => r.ttsFirstChunkMs ?? 0)),
		rssMb: percentiles(ok.map((r) => r.rssMb ?? 0)),
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

export const getTurnEventsSince = (
	domiaId: string,
	since: string,
	sinceId: string,
	limit: number,
) => dbAdapter.getTurnEventsSince(domiaId, since, sinceId, limit)

export const recordAnnouncement = (data: InsertAnnouncementType) =>
	dbAdapter.insertAnnouncement(data)

const TURN_EVENT_COLUMN_KEYS = new Set([
	"type",
	"interactionId",
	"originDomiaKey",
	"executorDomiaKey",
	"satelliteId",
	"traceId",
	"ts",
	"seq",
])

export const persistTurnEventBatch = async (
	interactionId: string,
	events: DomiaTurnEventType[],
): Promise<void> => {
	if (events.length === 0) return
	const interaction = await dbAdapter.getInteractionById(interactionId)
	if (!interaction) return
	const settings = await dbAdapter.getTurnEventsPersist(interaction.domiaId)
	if (settings && settings.turnEventsPersist === false) return
	const rows: InsertTurnEventType[] = events.map((e) => {
		const payload: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(e))
			if (!TURN_EVENT_COLUMN_KEYS.has(k)) payload[k] = v
		return {
			id: generateUuid(),
			domiaId: interaction.domiaId,
			interactionId,
			type: e.type,
			seq: e.seq,
			ts: e.ts,
			originDomiaKey: e.originDomiaKey ?? null,
			executorDomiaKey: e.executorDomiaKey ?? null,
			satelliteId: e.satelliteId ?? null,
			traceId: e.traceId ?? null,
			payload,
			createdAt: new Date(e.ts)
				.toISOString()
				.replace("T", " ")
				.replace("Z", ""),
		}
	})
	await dbAdapter.insertTurnEvents(rows)
}

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

export const getLastTurnEventAt = async (domiaId: string) => {
	const row = await dbAdapter.getLastTurnEventAt(domiaId)
	return row?.createdAt ?? null
}

export const getLastAnnouncementAt = async (domiaId: string) => {
	const row = await dbAdapter.getLastAnnouncementAt(domiaId)
	return row?.updatedAt ?? null
}

const SESSION_SUMMARY_MIN_TURNS = 2
const SESSION_SUMMARY_MAX_TURNS = 24

export const summarizeSession = async (
	domia: DomiaType,
	sessionId: string,
): Promise<void> => {
	try {
		const rows = await dbAdapter.getRecentInteractionsForDomia(
			domia.id,
			SESSION_SUMMARY_MAX_TURNS,
		)
		const turns = rows
			.filter((r) => r.sessionId === sessionId)
			.reverse()
			.map((r) => {
				const user = r.inputRaw ?? r.sttResult ?? ""
				const you = r.heardReply ?? r.llmResponse ?? ""
				return user || you ? `User: ${user}\nYou: ${you}` : ""
			})
			.filter(Boolean)
		if (turns.length < SESSION_SUMMARY_MIN_TURNS) return

		const deadline = Date.now() + SUMMARIZE_MAX_IDLE_WAIT_MS
		while (activeVoiceReplies(domia.id) > 0) {
			if (Date.now() >= deadline) {
				memoryLogger.info(
					"session summary skipped — voice stayed busy (best-effort)",
					{ domiaId: domia.id, sessionId },
				)
				return
			}
			await new Promise((r) => setTimeout(r, SUMMARIZE_IDLE_POLL_MS))
		}

		const name = domia.characterProfile?.name?.trim() || "Domia"
		const prompt = `You are ${name}. The conversation below just ended. Summarize it for your own memory. Return ONLY a JSON object:
{"summary":"2-3 sentences: what happened, the emotional arc, and what you learned about this person","moodArc":"a short phrase","topics":["a","few","topics"],"userSummary":"one line updating your private model of this person — who they are and how they relate to you","moodTendencies":"a short phrase","interests":["their","interests"]}

Conversation:
${turns.join("\n")}`

		const reflectionModel = domia.llmModelConfig?.reflectionModelName?.trim()
		const summarizer =
			reflectionModel && domia.llmModelConfig
				? {
						...domia,
						llmModelConfig: {
							...domia.llmModelConfig,
							modelName: reflectionModel,
						},
					}
				: domia
		const raw = await runLLMJson(summarizer, prompt)
		const { value: obj, state } = parseLlmJson(raw, sessionSummarySchema)
		if (!obj) return
		if (state === "repaired") {
			memoryLogger.warn("llm-json repaired", {
				site: "session-summary",
				model: summarizer.llmModelConfig?.modelName,
				rawLength: raw.length,
			})
		}
		if (obj.summary?.trim()) {
			await recordEpisode(domia, sessionId, {
				summary: obj.summary.trim(),
				moodArc: obj.moodArc ?? null,
				topics: Array.isArray(obj.topics) ? obj.topics : null,
			})
		}
		await patchUserModel(domia, {
			summary: obj.userSummary ?? null,
			moodTendencies: obj.moodTendencies ?? null,
			interests: Array.isArray(obj.interests) ? obj.interests : null,
		})
		memoryLogger.info("🧠 session summarized → episode + user-model", {
			domiaId: domia.id,
			sessionId,
			turns: turns.length,
		})
	} catch (err) {
		memoryLogger.warn("session summarize failed (skipping)", {
			domiaId: domia.id,
			err,
		})
	}
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

	if (existingSession && expired) {
		void summarizeSession(domia, existingSession.sessionId)
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
	sourceOverride?: TurnEventInputSourceType,
): Promise<string | null> => {
	const emitStarted = (interactionId: string): void => {
		const satelliteId = defaultData.satelliteId ?? undefined
		const isText = defaultData.inputType === INTERACTION_INPUT_TYPE_ENUM.TEXT
		const source: TurnEventInputSourceType =
			sourceOverride ?? (satelliteId ? "satellite" : isText ? "http" : "local")
		emitTurnEvent({
			type: DOMIA_TURN_EVENT_ENUM.TURN_STARTED,
			interactionId,
			originDomiaKey: domia.domiaKey,
			satelliteId,
			inputType: isText ? "text" : "voice",
			source,
		})
	}

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
			emitStarted(existingInteractionId)
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
		emitStarted(interactionId)
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

export const recordImplicitFeedback = (
	interactionId: string,
	signal: ImplicitFeedbackType,
): void => {
	void dbAdapter
		.updateInteractionTrace({ id: interactionId, implicitFeedback: signal })
		.catch(() => undefined)
}

export const getInteractionById = async (
	interactionId: string,
	client?: DBClientOrTxType,
) => {
	const rows = await dbAdapter.getInteractionById(interactionId, client)
	return rows
}

const withinMaxAge = (
	row: SelectInteractionTraceType,
	now: number,
	maxAgeMs: number,
): boolean => {
	const ts = row.createdAt ? Date.parse(row.createdAt + "Z") : NaN
	return !Number.isNaN(ts) && now - ts <= maxAgeMs
}

const mapRowsToMoods = (
	rows: SelectInteractionTraceType[],
	maxAgeMs: number,
	limit: number,
): string[] => {
	const now = Date.now()
	return rows
		.filter((row) => withinMaxAge(row, now, maxAgeMs))
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
}

const mapRowsToTurns = (
	rows: SelectInteractionTraceType[],
	maxAgeMs: number,
	limit: number,
	excludeInteractionId: string | undefined,
): RecentTurnType[] => {
	const now = Date.now()
	const eligible = rows
		.filter((row) => row.id !== excludeInteractionId)
		.filter((row) => withinMaxAge(row, now, maxAgeMs))
		.map((row) => ({
			userText: row.inputRaw ?? row.sttResult ?? null,
			domiaText:
				row.heardReply === ""
					? null
					: (row.heardReply ?? row.llmResponse ?? row.finalOutput ?? null),
			createdAt: row.createdAt,
		}))
		.filter((turn) => turn.userText && turn.domiaText)
	// grow to 2·limit−1 then trim in limit-sized jumps — a hard sliding cap would re-shift the section (and kill the prefix cache) every turn
	const take =
		eligible.length <= limit ? limit : limit + (eligible.length % limit)
	return eligible.slice(0, take).reverse()
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
		return mapRowsToMoods(
			rows,
			domia?.memoryMaxAgeMs ?? RECENT_TURNS_MAX_AGE_MS,
			limit,
		)
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
		const rows = await dbAdapter.getRecentInteractionsForDomia(
			domia.id,
			limit * 3,
		)
		return mapRowsToTurns(
			rows,
			domia?.memoryMaxAgeMs ?? RECENT_TURNS_MAX_AGE_MS,
			limit,
			excludeInteractionId,
		)
	} catch {
		return []
	}
}

export const getRecentTurnsAndMoods = async (
	domia: DomiaType,
	excludeInteractionId: string | undefined,
): Promise<RecentTurnsAndMoodsType> => {
	try {
		const turnsLimit = domia?.memoryWindowTurns ?? RECENT_TURNS_WINDOW
		const moodLimit = RECENT_TURNS_WINDOW
		const rows = await dbAdapter.getRecentInteractionsForDomia(
			domia.id,
			Math.max(turnsLimit, moodLimit) * 3,
		)
		const maxAgeMs = domia?.memoryMaxAgeMs ?? RECENT_TURNS_MAX_AGE_MS
		return {
			recentTurns:
				turnsLimit > 0
					? mapRowsToTurns(rows, maxAgeMs, turnsLimit, excludeInteractionId)
					: [],
			userMoodTrend: mapRowsToMoods(rows, maxAgeMs, moodLimit),
		}
	} catch {
		return { recentTurns: [], userMoodTrend: [] }
	}
}

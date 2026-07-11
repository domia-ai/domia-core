import { type DomiaType, resolveOllamaHost } from "@/modules/core"
import { requestRestart } from "@/modules/runtime-control"
import {
	getInteractionsSince,
	getSessionsSince,
	getAnnouncementsSince,
	getTurnEventsSince,
	getLatencyStats,
} from "@/modules/session-manager"
import { speculationStats, bargeInStats } from "@/modules/core-bus"
import { getEmotionEventsSince } from "@/modules/emotion-engine"
import { getFactsSince } from "@/modules/memory"
import { listModels, startInstall, getModelJob } from "@/modules/model-manager"
import type { GetSyncQueryType, GetSyncResponseType } from "../types"
import { getSyncQuerySchema } from "../schemas"
import { httpServerLogger } from "@/utils"
import type { FastifyReply } from "fastify"

export const handleGetRoot = () => {
	return { message: "DOMIA HTTP Server is running ✅" }
}

export const handleGetHealth = () => {
	return { status: "ok", timestamp: new Date().toISOString() }
}

export const handleGetLatencyStats = async (domia: DomiaType) => {
	const stats = await getLatencyStats(domia)
	return {
		stats: {
			...stats,
			speculation: speculationStats(domia.id),
			bargeIn: bargeInStats(domia.id),
		},
	}
}

export const handleGetModels = async (domia: DomiaType) => {
	return { models: await listModels(resolveOllamaHost(domia)) }
}

export const handlePostModelInstall = async (
	domia: DomiaType,
	body: unknown,
	reply: FastifyReply,
) => {
	try {
		return { job: startInstall(body, resolveOllamaHost(domia)) }
	} catch (err) {
		httpServerLogger.error("Model install request failed", { err })
		return reply.code(400).send({ error: "Invalid model install spec" })
	}
}

export const handleGetModelJob = async (id: string, reply: FastifyReply) => {
	const job = getModelJob(id)
	if (!job) return reply.code(404).send({ error: "Job not found" })
	return { job }
}

export const handleRestart = async () => {
	requestRestart()
	return { restarting: true }
}

export const handleGetSync = async (
	domia: DomiaType,
	query: GetSyncQueryType,
): Promise<GetSyncResponseType> => {
	const { since, turnSince, turnId, limit } = getSyncQuerySchema.parse(query)
	const domiaId = domia.id

	const [
		interactions,
		sessions,
		emotionEvents,
		facts,
		announcements,
		turnEvents,
	] = await Promise.all([
		getInteractionsSince(domiaId, since, limit),
		getSessionsSince(domiaId, since, limit),
		getEmotionEventsSince(domiaId, since, limit),
		getFactsSince(domiaId, since, limit),
		getAnnouncementsSince(domiaId, since, limit),
		getTurnEventsSince(domiaId, turnSince, turnId, limit),
	])

	const maxTs = (stamps: (string | null)[]): string =>
		stamps.reduce<string>((m, s) => (s && s > m ? s : m), "")

	const streams = [
		{
			max: maxTs(interactions.map((r) => r.updatedAt)),
			full: interactions.length >= limit,
		},
		{
			max: maxTs(sessions.map((r) => r.updatedAt)),
			full: sessions.length >= limit,
		},
		{
			max: maxTs(emotionEvents.map((r) => r.createdAt)),
			full: emotionEvents.length >= limit,
		},
		{ max: maxTs(facts.map((r) => r.updatedAt)), full: facts.length >= limit },
		{
			max: maxTs(announcements.map((r) => r.updatedAt)),
			full: announcements.length >= limit,
		},
	]
	const fullMaxes = streams.filter((s) => s.full && s.max).map((s) => s.max)
	const allMaxes = streams.map((s) => s.max).filter(Boolean)
	const nextCursor = fullMaxes.length
		? fullMaxes.reduce((a, b) => (a < b ? a : b))
		: allMaxes.length
			? allMaxes.reduce((a, b) => (a > b ? a : b))
			: since

	const lastTurn = turnEvents[turnEvents.length - 1]
	const nextTurnCursor = lastTurn
		? { since: lastTurn.createdAt, id: lastTurn.id }
		: null

	return {
		interactions,
		sessions,
		emotionEvents,
		facts,
		announcements,
		turnEvents,
		nextCursor,
		nextTurnCursor,
	}
}

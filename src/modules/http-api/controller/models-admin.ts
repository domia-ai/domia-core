import { type DomiaType, resolveOllamaHost } from "@/modules/core"
import { requestRestart } from "@/modules/runtime-control"
import {
	getInteractionsSince,
	getInteractionById,
	getSessionsSince,
	getAnnouncementsSince,
	getTurnEventsSince,
	getLatencyStats,
} from "@/modules/session-manager"
import {
	speculationStats,
	bargeInStats,
	twoTierStats,
} from "@/modules/core-bus"
import { getEmotionEventsSince } from "@/modules/emotion-engine"
import { getFactsSince } from "@/modules/memory"
import { listModels, startInstall, getModelJob } from "@/modules/model-manager"
import { stripDomiaSnapshotSecrets } from "@/modules/config"
import type {
	GetSyncQueryType,
	GetSyncResponseType,
	GetInteractionResponseType,
} from "../types"
import { getSyncQuerySchema } from "../schemas"
import { httpServerLogger, isDomiaError, MODEL_MANAGER_ERRORS } from "@/utils"
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
			twoTier: twoTierStats(domia.id),
		},
	}
}

export const handleGetInteraction = async (
	domia: DomiaType,
	interactionId: string,
	reply: FastifyReply,
): Promise<GetInteractionResponseType> => {
	const interaction = await getInteractionById(interactionId)
	if (interaction?.domiaId !== domia.id)
		return reply.code(404).send({ error: "Interaction not found" })
	return {
		interaction: {
			...interaction,
			domiaSnapshot: stripDomiaSnapshotSecrets(interaction.domiaSnapshot),
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
		return {
			job: startInstall(
				body,
				resolveOllamaHost(domia),
				domia.modelInstallAllowedHosts,
			),
		}
	} catch (err) {
		httpServerLogger.error("Model install request failed", { err })
		const overloaded =
			isDomiaError(err) &&
			err.code === MODEL_MANAGER_ERRORS.TOO_MANY_INSTALL_JOBS.code
		return reply.code(overloaded ? 429 : 400).send({
			error: isDomiaError(err) ? err.message : "Invalid model install spec",
		})
	}
}

export const handleGetModelJob = async (id: string, reply: FastifyReply) => {
	const job = getModelJob(id)
	if (!job) return reply.code(404).send({ error: "Job not found" })
	return { job }
}

export const handleRestart = () => {
	requestRestart()
	return { restarting: true }
}

export const handleGetSync = async (
	domia: DomiaType,
	query: GetSyncQueryType,
): Promise<GetSyncResponseType> => {
	const { since, turnSince, turnId, factsSince, factsId, limit } =
		getSyncQuerySchema.parse(query)
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
		getFactsSince(domiaId, factsSince || since, factsId, limit),
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

	const lastTurn = turnEvents.at(-1)
	const nextTurnCursor = lastTurn
		? { since: lastTurn.createdAt, id: lastTurn.id }
		: null

	const lastFact = facts.at(-1)
	const nextFactsCursor = lastFact
		? { since: lastFact.updatedAt, id: lastFact.id }
		: null

	return {
		interactions: interactions.map((row) => ({
			...row,
			domiaSnapshot: stripDomiaSnapshotSecrets(row.domiaSnapshot),
		})),
		sessions,
		emotionEvents,
		facts,
		announcements,
		turnEvents,
		nextCursor,
		nextTurnCursor,
		nextFactsCursor,
	}
}

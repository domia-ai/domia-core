import {
	getDomia,
	invalidateOwnDomia,
	setSatelliteDesiredWakeWords,
	setSatelliteDesiredNumber,
	setSatelliteDesiredVolume,
	setSatelliteFollowUp,
	getOwnDomia,
} from "@/modules/core"
import {
	postSatelliteWakeWordsBodySchema,
	postSatelliteNumberBodySchema,
	postSatelliteVolumeBodySchema,
	postSatelliteTimerBodySchema,
	postSatelliteFollowUpBodySchema,
} from "../schemas"
import {
	renderAnnouncementUrl,
	getSatelliteControl,
	startSatelliteTimer,
	cancelSatelliteTimer,
	listSatelliteTimers,
	getPresence,
} from "@/modules/core-bus"
import { httpServerLogger } from "@/utils"
import type { FastifyReply } from "fastify"

const SATELLITE_TEST_PHRASE =
	"Hi, this is a test from Domia. If you can hear me, your speaker is working."

export const handleSetSatelliteWakeWords = async (
	domiaKey: string | undefined,
	satelliteId: string,
	body: unknown,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	const parsed = postSatelliteWakeWordsBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid wake words body" })
	}
	const updated = await setSatelliteDesiredWakeWords(
		domia.id,
		satelliteId,
		parsed.data.wakeWords,
	)
	if (updated.length === 0) {
		return reply
			.code(404)
			.send({ error: `satellite not bound to ${domiaKey}: ${satelliteId}` })
	}
	invalidateOwnDomia(domiaKey)
	const control = getSatelliteControl(domiaKey, satelliteId)
	control?.setWakeWords(parsed.data.wakeWords)
	return { applied: true, live: !!control }
}

export const handleSetSatelliteNumber = async (
	domiaKey: string | undefined,
	satelliteId: string,
	body: unknown,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	const parsed = postSatelliteNumberBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid number body" })
	}
	const { entityId, value } = parsed.data
	const entity = getPresence(domiaKey)
		?.satellites.find((s) => s.satelliteId === satelliteId)
		?.numberEntities.find((n) => n.id === entityId)
	if (entity) {
		if (
			(entity.min != null && value < entity.min) ||
			(entity.max != null && value > entity.max)
		) {
			return reply.code(400).send({
				error: `value ${value} out of range [${entity.min}, ${entity.max}] for ${entityId}`,
			})
		}
	} else {
		httpServerLogger.warn("setting unvalidated satellite number (offline?)", {
			domiaKey,
			satelliteId,
			entityId,
		})
	}
	const updated = await setSatelliteDesiredNumber(
		domia.id,
		satelliteId,
		entityId,
		value,
	)
	if (updated.length === 0) {
		return reply
			.code(404)
			.send({ error: `satellite not bound to ${domiaKey}: ${satelliteId}` })
	}
	invalidateOwnDomia(domiaKey)
	const control = getSatelliteControl(domiaKey, satelliteId)
	control?.setNumber?.(entityId, value)
	return { applied: true, live: !!control?.setNumber }
}

export const handleSetSatelliteFollowUp = async (
	domiaKey: string | undefined,
	satelliteId: string,
	body: unknown,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	const parsed = postSatelliteFollowUpBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid follow-up body" })
	}
	const updated = await setSatelliteFollowUp(
		domia.id,
		satelliteId,
		parsed.data.enabled,
	)
	if (updated.length === 0) {
		return reply
			.code(404)
			.send({ error: `satellite not bound to ${domiaKey}: ${satelliteId}` })
	}
	invalidateOwnDomia(domiaKey)
	const control = getSatelliteControl(domiaKey, satelliteId)
	control?.setFollowUp?.(parsed.data.enabled)
	return { applied: true, live: !!control?.setFollowUp }
}

export const handleStartSatelliteTimer = async (
	domiaKey: string | undefined,
	satelliteId: string,
	body: unknown,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const parsed = postSatelliteTimerBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid timer body" })
	}
	const control = getSatelliteControl(domiaKey, satelliteId)
	if (!control?.sendTimerEvent) {
		return reply.code(409).send({
			error: `satellite ${satelliteId} does not support timers or is offline`,
		})
	}
	const timer = startSatelliteTimer(
		domiaKey,
		satelliteId,
		parsed.data.name ?? "Timer",
		parsed.data.seconds,
	)
	return { started: true, timerId: timer.timerId }
}

export const handleCancelSatelliteTimer = async (
	domiaKey: string | undefined,
	satelliteId: string,
	timerId: string,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const cancelled = cancelSatelliteTimer(timerId)
	if (!cancelled) {
		return reply.code(404).send({ error: `no active timer ${timerId}` })
	}
	return { cancelled: true }
}

export const handleListSatelliteTimers = async (
	domiaKey: string | undefined,
	satelliteId: string,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const active = listSatelliteTimers(domiaKey, satelliteId).map((t) => ({
		timerId: t.timerId,
		name: t.name,
		totalSeconds: t.totalSeconds,
		secondsLeft: Math.max(
			0,
			t.totalSeconds - Math.round((Date.now() - t.startedAt) / 1000),
		),
	}))
	return { timers: active }
}

export const handleSetSatelliteVolume = async (
	domiaKey: string | undefined,
	satelliteId: string,
	body: unknown,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	const parsed = postSatelliteVolumeBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid volume body" })
	}
	const updated = await setSatelliteDesiredVolume(
		domia.id,
		satelliteId,
		parsed.data.volume,
	)
	if (updated.length === 0) {
		return reply
			.code(404)
			.send({ error: `satellite not bound to ${domiaKey}: ${satelliteId}` })
	}
	invalidateOwnDomia(domiaKey)
	const control = getSatelliteControl(domiaKey, satelliteId)
	control?.setVolume?.(parsed.data.volume)
	return { applied: true, live: !!control?.setVolume }
}

export const handleTestSatelliteSpeaker = async (
	domiaKey: string | undefined,
	satelliteId: string,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getOwnDomia(domiaKey).catch(() => null)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	const control = getSatelliteControl(domiaKey, satelliteId)
	if (!control) {
		return reply.code(409).send({ error: "satellite not connected" })
	}
	const url = await renderAnnouncementUrl(domia, SATELLITE_TEST_PHRASE)
	if (!url) {
		return reply.code(503).send({ error: "TTS unavailable" })
	}
	control.announce(url)
	httpServerLogger.info(`🔊 /satellites/${satelliteId}/test-speaker`, {
		domiaKey,
		delivered: true,
	})
	return { delivered: true, target: "satellite" }
}

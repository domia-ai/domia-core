import type { FastifyReply } from "fastify"

import { getOwnDomia, getSatellitesForDomia } from "@/modules/core"
import {
	listScheduleItems,
	getScheduleItem,
	createScheduleItem,
	cancelScheduleItem,
	getProactivityStatus,
} from "@/modules/proactivity"
import { httpServerLogger } from "@/utils"
import { postScheduleBodySchema, getScheduleQuerySchema } from "../schemas"
import { badRequest } from "../utils/http-errors"
import { resolveHostedIdentity } from "../utils/hosted-identity"

export const handleGetProactivitySchedule = async (
	domiaKey: string | undefined,
	query: unknown,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const parsed = getScheduleQuerySchema.safeParse(query ?? {})
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid schedule query")
	const statuses = parsed.data.status
		? parsed.data.status.split(",").map((s) => s.trim())
		: undefined
	const items = listScheduleItems(
		identity.id,
		statuses as Parameters<typeof listScheduleItems>[1],
	)
	return { items }
}

export const handlePostProactivitySchedule = async (
	domiaKey: string | undefined,
	body: unknown,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const parsed = postScheduleBodySchema.safeParse(body)
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid schedule body")
	const { inMs, dueAt, ...rest } = parsed.data
	if (rest.targetKind === "satellite") {
		const bound = (await getSatellitesForDomia(identity.id)).some(
			(s) => s.satelliteId === rest.targetSatelliteId,
		)
		if (!bound) {
			return reply.code(404).send({
				error: `satellite not bound to ${identity.domiaKey}: ${rest.targetSatelliteId ?? ""}`,
			})
		}
	}
	const resolvedDueAt = new Date(
		dueAt ?? Date.now() + (inMs ?? 0),
	).toISOString()
	const item = createScheduleItem(identity.id, {
		...rest,
		dueAt: resolvedDueAt,
	})
	httpServerLogger.info(`🔔 POST /proactivity/schedule "${item.name}"`, {
		domiaKey: identity.domiaKey,
		scheduleId: item.id,
		dueAt: item.dueAt,
	})
	return reply.code(201).send({ item })
}

export const handleDeleteProactivitySchedule = async (
	domiaKey: string | undefined,
	id: string,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const cancelled = cancelScheduleItem(identity.id, id)
	if (!cancelled) {
		const existing = getScheduleItem(identity.id, id)
		if (!existing)
			return reply.code(404).send({ error: `unknown schedule item: ${id}` })
		return reply
			.code(409)
			.send({ error: `schedule item already ${existing.status}: ${id}` })
	}
	return { cancelled: true, item: cancelled }
}

export const handleGetProactivityStatus = async (
	domiaKey: string | undefined,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const live = await getOwnDomia(identity.domiaKey).catch((err: unknown) => {
		httpServerLogger.warn("identity lookup failed", {
			err,
			domiaKey: identity.domiaKey,
		})
		return null
	})
	if (!live) {
		return reply
			.code(404)
			.send({ error: `unknown identity: ${identity.domiaKey}` })
	}
	return getProactivityStatus(live)
}

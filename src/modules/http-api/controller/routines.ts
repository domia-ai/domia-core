import type { FastifyReply } from "fastify"

import { getOwnDomia, invalidateOwnDomia } from "@/modules/core"
import { invalidateFastPathIndex } from "@/modules/fast-path"
import {
	isBuiltinProvider,
	listTools,
	removeRoutine,
	routinesOf,
	saveRoutine,
} from "@/modules/skill-engine"
import { httpServerLogger, isDomiaError, SKILL_ERRORS } from "@/utils"

import { postRoutineBodySchema } from "../schemas"
import { badRequest, conflict, notFound } from "../utils/http-errors"
import { resolveHostedIdentity } from "../utils/hosted-identity"
import type {
	DeleteRoutineResponseType,
	GetRoutinesResponseType,
	PostRoutineResponseType,
} from "../types"

const refreshRoutineTools = async (domiaKey: string): Promise<void> => {
	invalidateOwnDomia(domiaKey)
	const live = await getOwnDomia(domiaKey)
	if (!live) return
	const builtinIds = (live.skillProviders ?? [])
		.filter(isBuiltinProvider)
		.map((p) => p.id)
	if (builtinIds.length > 0)
		await listTools(live, { force: true, providerIds: builtinIds })
	invalidateOwnDomia(domiaKey)
	invalidateFastPathIndex(live.id)
}

export const handleGetRoutines = async (
	domiaKey: string | undefined,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const response: GetRoutinesResponseType = {
		routines: routinesOf(identity.id),
	}
	return response
}

export const handlePostRoutine = async (
	domiaKey: string | undefined,
	body: unknown,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const parsed = postRoutineBodySchema.safeParse(body)
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid routine body")
	const input = parsed.data
	const existing = routinesOf(identity.id)
	const byId = input.id ? existing.find((r) => r.id === input.id) : undefined
	if (input.id && !byId) return notFound(reply, `unknown routine: ${input.id}`)
	const bySlug = existing.find((r) => r.slug === input.slug)
	if (bySlug && byId && bySlug.id !== byId.id)
		return conflict(reply, `slug already used by routine ${bySlug.id}`)
	try {
		const saved = saveRoutine(identity.id, input)
		await refreshRoutineTools(identity.domiaKey)
		httpServerLogger.info(
			`🧩 POST /routines "${saved.routine.slug}" (${saved.created ? "created" : "updated"})`,
			{ domiaKey: identity.domiaKey, routineId: saved.routine.id },
		)
		const response: PostRoutineResponseType = saved
		return await reply.code(saved.created ? 201 : 200).send(response)
	} catch (error) {
		if (isDomiaError(error) && error.code === SKILL_ERRORS.ROUTINE_INVALID.code)
			return reply.code(400).send({ error: error.message })
		throw error
	}
}

export const handleDeleteRoutine = async (
	domiaKey: string | undefined,
	id: string,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	if (!removeRoutine(identity.id, id))
		return notFound(reply, `unknown routine: ${id}`)
	await refreshRoutineTools(identity.domiaKey)
	httpServerLogger.info("🧩 DELETE /routines", {
		domiaKey: identity.domiaKey,
		routineId: id,
	})
	const response: DeleteRoutineResponseType = { deleted: true, id }
	return response
}

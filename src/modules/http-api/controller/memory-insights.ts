import type { FastifyReply } from "fastify"

import {
	getLastEpisodes,
	getUserModelRow,
	listFactEvidence,
} from "@/modules/memory"

import {
	getFactEvidenceQuerySchema,
	getMemoryEpisodesQuerySchema,
} from "../schemas"
import { badRequest, notFound } from "../utils/http-errors"
import { resolveHostedIdentity } from "../utils/hosted-identity"
import type {
	GetFactEvidenceResponseType,
	GetMemoryEpisodesResponseType,
	GetUserModelResponseType,
} from "../types"

export const handleGetMemoryEpisodes = async (
	query: unknown,
	reply: FastifyReply,
) => {
	const parsed = getMemoryEpisodesQuerySchema.safeParse(query ?? {})
	if (!parsed.success) return badRequest(reply, parsed.error, "Invalid query")
	const identity = await resolveHostedIdentity(parsed.data.domiaKey, reply)
	if (!identity) return
	const response: GetMemoryEpisodesResponseType = {
		episodes: await getLastEpisodes(identity.id, parsed.data.limit),
	}
	return response
}

export const handleGetUserModel = async (
	domiaKey: string | undefined,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const response: GetUserModelResponseType = {
		userModel: (await getUserModelRow(identity.id)) ?? null,
	}
	return response
}

export const handleGetFactEvidence = async (
	factId: string,
	query: unknown,
	reply: FastifyReply,
) => {
	const parsed = getFactEvidenceQuerySchema.safeParse(query ?? {})
	if (!parsed.success) return badRequest(reply, parsed.error, "Invalid query")
	const identity = await resolveHostedIdentity(parsed.data.domiaKey, reply)
	if (!identity) return
	const evidence = await listFactEvidence(
		identity.id,
		factId,
		parsed.data.limit,
	)
	if (!evidence) return notFound(reply, `unknown fact: ${factId}`)
	const response: GetFactEvidenceResponseType = { factId, evidence }
	return response
}

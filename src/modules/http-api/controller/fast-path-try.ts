import type { FastifyReply } from "fastify"

import { getOwnDomia } from "@/modules/core"
import { matchFastPath } from "@/modules/fast-path"

import { postFastPathTryBodySchema } from "../schemas"
import { badRequest, notFound } from "../utils/http-errors"
import { resolveHostedIdentity } from "../utils/hosted-identity"
import type { PostFastPathTryResponseType } from "../types"

export const handlePostFastPathTry = async (
	domiaKey: string | undefined,
	body: unknown,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const parsed = postFastPathTryBodySchema.safeParse(body)
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid fast-path try body")
	const live = await getOwnDomia(identity.domiaKey)
	if (!live) return notFound(reply, `unknown identity: ${identity.domiaKey}`)
	const response: PostFastPathTryResponseType = {
		verdict: matchFastPath(live, parsed.data.text, null),
	}
	return response
}

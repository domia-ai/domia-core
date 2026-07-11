import type { FastifyReply } from "fastify"

import { getDomia, invalidateOwnDomia } from "@/modules/core"
import { deleteIdentityData } from "@/modules/data-privacy"
import { clearConfirmationsForDomia } from "@/modules/agent"

export const handleDeleteIdentityData = async (
	domiaKey: string | undefined,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	return deleteIdentityData(domia.id)
}

export const handleResetConversation = async (
	domiaKey: string | undefined,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	clearConfirmationsForDomia(domiaKey)
	invalidateOwnDomia(domiaKey)
	return { reset: true }
}

import type { FastifyReply } from "fastify"

import { getDomia, invalidateOwnDomia } from "@/modules/core"
import { deleteIdentityData } from "@/modules/data-privacy"
import { clearConfirmationsForDomia } from "@/modules/agent"
import { resetConversation } from "@/modules/session-manager"

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
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	clearConfirmationsForDomia(domiaKey)
	await resetConversation(domia)
	invalidateOwnDomia(domiaKey)
	return { reset: true }
}

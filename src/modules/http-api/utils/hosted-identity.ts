import type { FastifyReply } from "fastify"

import { getDomia, type DomiaType } from "@/modules/core"

export const resolveHostedIdentity = async (
	domiaKey: string | undefined,
	reply: FastifyReply,
): Promise<DomiaType | null> => {
	if (!domiaKey) {
		await reply.code(400).send({ error: "missing domiaKey" })
		return null
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		await reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
		return null
	}
	if (!domia.isHosted) {
		await reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
		return null
	}
	return domia
}

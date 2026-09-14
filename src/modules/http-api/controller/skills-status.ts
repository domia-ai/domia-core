import type { FastifyReply } from "fastify"

import { getDomia } from "@/modules/core"
import { providerStatuses, discoverProviders } from "@/modules/skill-engine"

import type { GetSkillsResponseType } from "../types"

export const handleDiscoverSkills = async () => ({
	providers: await discoverProviders(),
})

export const handleGetSkills = async (
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
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	const response: GetSkillsResponseType = {
		skillsEngine: domia.moduleSettings?.skillsEngine === true,
		providers: providerStatuses(domia),
	}
	return response
}

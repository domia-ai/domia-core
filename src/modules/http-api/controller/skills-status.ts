import type { FastifyReply } from "fastify"
import { z } from "zod"

import {
	SKILL_DESCRIPTOR_RESOURCE_URI,
	SKILL_SERVER_DESCRIPTOR_ALLOWED_FIELDS,
	SKILL_SERVER_DESCRIPTOR_STRIPPED_FIELDS,
	SKILL_SERVER_DESCRIPTOR_REJECTED_FIELDS,
	SKILL_SERVER_DESCRIPTOR_MAX_BYTES,
	SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATES,
	SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
	SKILL_SERVER_DESCRIPTOR_MAX_EXPANSION_RULES,
	SKILL_SERVER_DESCRIPTOR_MAX_EXPANSION_DEPTH,
	SKILL_SERVER_DESCRIPTOR_MAX_SLOT_VALUES,
	SKILL_SERVER_DESCRIPTOR_MAX_FINALIZE_CHARS,
	SKILL_SERVER_DESCRIPTOR_MAX_DESCRIPTION_CHARS,
} from "@/db"
import { getDomia } from "@/modules/core"
import {
	providerStatuses,
	discoverProviders,
	domiaSkillDescriptorSchema,
} from "@/modules/skill-engine"

import type {
	GetSkillsResponseType,
	GetSkillDescriptorSchemaResponseType,
} from "../types"

const descriptorSchemaResponse: GetSkillDescriptorSchemaResponseType = {
	schema: z.toJSONSchema(domiaSkillDescriptorSchema, {
		unrepresentable: "any",
	}),
	resourceUri: SKILL_DESCRIPTOR_RESOURCE_URI,
	serverAllowed: [...SKILL_SERVER_DESCRIPTOR_ALLOWED_FIELDS],
	stripped: [...SKILL_SERVER_DESCRIPTOR_STRIPPED_FIELDS],
	rejected: [...SKILL_SERVER_DESCRIPTOR_REJECTED_FIELDS],
	limits: {
		maxBytes: SKILL_SERVER_DESCRIPTOR_MAX_BYTES,
		maxTemplates: SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATES,
		maxTemplateChars: SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
		maxExpansionRules: SKILL_SERVER_DESCRIPTOR_MAX_EXPANSION_RULES,
		maxExpansionDepth: SKILL_SERVER_DESCRIPTOR_MAX_EXPANSION_DEPTH,
		maxSlotValues: SKILL_SERVER_DESCRIPTOR_MAX_SLOT_VALUES,
		maxFinalizeChars: SKILL_SERVER_DESCRIPTOR_MAX_FINALIZE_CHARS,
		maxDescriptionChars: SKILL_SERVER_DESCRIPTOR_MAX_DESCRIPTION_CHARS,
	},
}

export const handleGetSkillDescriptorSchema =
	(): GetSkillDescriptorSchemaResponseType => descriptorSchemaResponse

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
		builtinTools: domia.moduleSettings?.builtinTools === true,
		providers: providerStatuses(domia),
	}
	return response
}

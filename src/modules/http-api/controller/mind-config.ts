import { ZodError } from "zod"
import { type DomiaType } from "@/modules/core"
import {
	listKnowledgeEntries,
	upsertKnowledgeEntry,
	deleteKnowledgeEntry,
} from "@/modules/memory"
import {
	serializeMind,
	importMind,
	listTemplates,
	activateTemplate,
} from "@/modules/mind"
import { serializeConfig, configHealth } from "@/modules/config"
import { applyConfig, getApplyState } from "@/modules/config-apply"
import type {
	GetConfigResponseType,
	PostConfigResponseType,
	PostImportMindBodyType,
	PostKnowledgeBodyType,
} from "../types"
import { postImportMindBodySchema, postKnowledgeBodySchema } from "../schemas"
import { badRequest } from "../utils/http-errors"
import { httpServerLogger } from "@/utils"
import type { FastifyReply } from "fastify"

export const handleGetMind = (domia: DomiaType) => {
	return { mind: serializeMind(domia) }
}

export const handleGetConfig = (domia: DomiaType): GetConfigResponseType => {
	return {
		config: serializeConfig(domia),
		apply: getApplyState(domia.domiaKey),
	}
}

export const handlePostConfig = async (
	domia: DomiaType,
	body: unknown,
	reply: FastifyReply,
): Promise<PostConfigResponseType | FastifyReply> => {
	try {
		const { config, apply } = await applyConfig(domia, body)
		return { config, apply, state: getApplyState(domia.domiaKey) }
	} catch (err) {
		httpServerLogger.error("Import config failed", { domiaId: domia.id, err })
		if (err instanceof ZodError)
			return badRequest(reply, err, "Invalid config bundle")
		return reply.code(500).send({ error: "Config import failed" })
	}
}

export const handleGetConfigHealth = (domia: DomiaType) => {
	return { health: configHealth(domia) }
}

export const handleGetKnowledge = async (domia: DomiaType) => {
	return { entries: await listKnowledgeEntries(domia) }
}

export const handlePostKnowledge = async (
	domia: DomiaType,
	body: unknown,
	reply: FastifyReply,
) => {
	const parsed = postKnowledgeBodySchema(domia.knowledgeMaxChars).safeParse(
		body,
	)
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid knowledge body")
	const b: PostKnowledgeBodyType = parsed.data
	await upsertKnowledgeEntry(domia, {
		id: b.id,
		title: b.title,
		content: b.content,
		keywords: b.keywords ?? null,
		priority: b.priority ?? 0,
		isActive: b.isActive ?? true,
	})
	return { ok: true }
}

export const handleDeleteKnowledge = async (domia: DomiaType, id: string) => {
	await deleteKnowledgeEntry(domia, id)
	return { ok: true }
}

export const handleImportMind = async (
	domia: DomiaType,
	body: PostImportMindBodyType,
	reply: FastifyReply,
) => {
	const { mind } = postImportMindBodySchema.parse(body)
	try {
		return { mind: importMind(domia, mind) }
	} catch (err) {
		httpServerLogger.error("Import mind failed", { domiaId: domia.id, err })
		return reply.code(400).send({ error: "Invalid mind bundle" })
	}
}

export const handleGetTemplates = () => {
	return { templates: listTemplates() }
}

export const handleActivateTemplate = async (
	domia: DomiaType,
	id: string,
	reply: FastifyReply,
) => {
	try {
		return { mind: activateTemplate(domia, id) }
	} catch (err) {
		httpServerLogger.error("Activate template failed", {
			domiaId: domia.id,
			err,
		})
		return reply.code(404).send({ error: "Template not found" })
	}
}

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
import { applyConfig } from "@/modules/config-apply"
import type { PostImportMindBodyType } from "../types"
import { postImportMindBodySchema } from "../schemas"
import { httpServerLogger } from "@/utils"
import type { FastifyReply } from "fastify"

export const handleGetMind = async (domia: DomiaType) => {
	return { mind: serializeMind(domia) }
}

export const handleGetConfig = async (domia: DomiaType) => {
	return { config: serializeConfig(domia) }
}

export const handlePostConfig = async (
	domia: DomiaType,
	body: unknown,
	reply: FastifyReply,
) => {
	try {
		return await applyConfig(domia, body)
	} catch (err) {
		httpServerLogger.error("Import config failed", { domiaId: domia.id, err })
		if (err instanceof ZodError)
			return reply
				.code(400)
				.send({ error: "Invalid config bundle", issues: err.issues })
		return reply.code(500).send({ error: "Config import failed" })
	}
}

export const handleGetConfigHealth = async (domia: DomiaType) => {
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
	const b = body as {
		id?: string
		title?: string
		content?: string
		keywords?: string[]
		priority?: number
		isActive?: boolean
	} | null
	if (!b?.title?.trim() || !b?.content?.trim())
		return reply.code(400).send({ error: "title and content are required" })
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

export const handleGetTemplates = async () => {
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

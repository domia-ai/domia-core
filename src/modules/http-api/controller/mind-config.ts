import { ZodError } from "zod"
import { type DomiaType, getOwnDomia, invalidateOwnDomia } from "@/modules/core"
import { invalidateFastPathIndex } from "@/modules/fast-path"
import {
	invalidateRoutines,
	isBuiltinProvider,
	listTools,
} from "@/modules/skill-engine"
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
import {
	exportMind,
	importMind as importMindBundle,
	type MindImportReportType,
	type MindSectionType,
} from "@/modules/mind-transfer"
import { serializeConfig, configHealth } from "@/modules/config"
import {
	applyConfig,
	getApplyState,
	reloadSubsystem,
} from "@/modules/config-apply"
import type {
	GetConfigResponseType,
	PostConfigResponseType,
	PostImportMindBundleBodyType,
	PostKnowledgeBodyType,
} from "../types"
import {
	getMindExportQuerySchema,
	postImportMindBodySchema,
	postImportMindBundleBodySchema,
	postKnowledgeBodySchema,
} from "../schemas"
import { badRequest } from "../utils/http-errors"
import { httpServerLogger, isDomiaError, MIND_TRANSFER_ERRORS } from "@/utils"
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

export const handleGetMindExport = (
	domia: DomiaType,
	query: unknown,
	reply: FastifyReply,
) => {
	const parsed = getMindExportQuerySchema.safeParse(query)
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid mind export query")
	return { bundle: exportMind(domia.id, { sections: parsed.data.sections }) }
}

const BUNDLE_FAILURE_STATUS: Record<string, number> = {
	[MIND_TRANSFER_ERRORS.BUNDLE_INVALID.code]: 400,
	[MIND_TRANSFER_ERRORS.BUNDLE_INCONSISTENT.code]: 400,
	[MIND_TRANSFER_ERRORS.IDENTITY_NOT_FOUND.code]: 404,
	[MIND_TRANSFER_ERRORS.REPLACE_TARGET_MISSING.code]: 400,
	[MIND_TRANSFER_ERRORS.IMPORT_CONFLICT.code]: 409,
	[MIND_TRANSFER_ERRORS.IMPORT_VERIFY_FAILED.code]: 409,
}

const isBundleBody = (body: unknown): boolean =>
	typeof body === "object" && body !== null && "bundle" in body

const sectionsWritten = (
	report: MindImportReportType,
	names: MindSectionType[],
): boolean =>
	names.some((name) => {
		const s = report.sections[name]
		return s !== undefined && s.cleared + s.inserted + s.updated > 0
	})

const refreshBuiltinTools = async (domiaKey: string): Promise<void> => {
	const live = await getOwnDomia(domiaKey)
	if (!live) return
	const builtinIds = (live.skillProviders ?? [])
		.filter(isBuiltinProvider)
		.map((p) => p.id)
	if (builtinIds.length > 0)
		await listTools(live, { force: true, providerIds: builtinIds })
	invalidateOwnDomia(domiaKey)
}

const refreshAfterMindImport = async (
	domia: DomiaType,
	report: MindImportReportType,
): Promise<void> => {
	invalidateRoutines(domia.id)
	invalidateOwnDomia(domia.domiaKey)
	invalidateFastPathIndex(domia.id)
	if (sectionsWritten(report, ["routine"]))
		await refreshBuiltinTools(domia.domiaKey)
	if (sectionsWritten(report, ["skill_provider"]))
		await reloadSubsystem("skills", domia.domiaKey)
	if (sectionsWritten(report, ["satellite_config"]))
		await reloadSubsystem("satellites", domia.domiaKey)
}

const handleImportMindBundle = async (
	domia: DomiaType,
	body: unknown,
	reply: FastifyReply,
) => {
	const parsed = postImportMindBundleBodySchema.safeParse(body)
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid mind bundle body")
	const imported = importOrReply(domia, parsed.data, reply)
	if (!("report" in imported)) return imported.failed
	try {
		await refreshAfterMindImport(domia, imported.report)
	} catch (err) {
		httpServerLogger.warn("Mind bundle imported but live refresh failed", {
			domiaId: domia.id,
			err,
		})
	}
	return { report: imported.report }
}

const importOrReply = (
	domia: DomiaType,
	body: PostImportMindBundleBodyType,
	reply: FastifyReply,
): { report: MindImportReportType } | { failed: FastifyReply } => {
	try {
		return {
			report: importMindBundle(domia.id, body.bundle, {
				mode: body.mode,
				onConflict: body.onConflict,
				sections: body.sections,
			}),
		}
	} catch (err) {
		httpServerLogger.error("Import mind bundle failed", {
			domiaId: domia.id,
			err,
		})
		if (!isDomiaError(err))
			return {
				failed: reply.code(500).send({ error: "Mind bundle import failed" }),
			}
		return {
			failed: reply
				.code(BUNDLE_FAILURE_STATUS[err.code] ?? 500)
				.send({ error: err.message, code: err.code, meta: err.meta }),
		}
	}
}

export const handleImportMind = async (
	domia: DomiaType,
	body: unknown,
	reply: FastifyReply,
) => {
	if (isBundleBody(body)) return handleImportMindBundle(domia, body, reply)
	const parsed = postImportMindBodySchema.safeParse(body)
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid mind body")
	try {
		return { mind: importMind(domia, parsed.data.mind) }
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

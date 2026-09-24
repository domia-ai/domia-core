import {
	DEFAULT_SKILL_MAX_LIST_PAGES,
	SKILL_DESCRIPTOR_RESOURCE_URI,
	type SelectSkillProviderType,
	type SkillToolType,
} from "@/db"
import { skillEngineLogger } from "@/utils"

import { skillElicitResultSchema } from "../../schemas"
import { ingestServerDescriptorText } from "../../utils/server-descriptor"
import type {
	McpContentPartType,
	ServerDescriptorReadType,
	ServerDescriptorSourceType,
	SkillElicitResultType,
	SkillRenderedContentType,
	ValidatedElicitResultType,
} from "../../types"

const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/

export const isAcceptedToolName = (name: string): boolean =>
	TOOL_NAME_RE.test(name)

export const buildAuthHeaders = (
	cfg: SelectSkillProviderType,
): Record<string, string> => {
	const headers: Record<string, string> = {}
	if (cfg.auth?.kind === "bearer" && cfg.auth.token)
		headers.Authorization = `Bearer ${cfg.auth.token}`
	else if (
		cfg.auth?.kind === "headers" &&
		typeof cfg.auth.headers === "object" &&
		!Array.isArray(cfg.auth.headers)
	)
		for (const [k, v] of Object.entries(cfg.auth.headers))
			if (typeof v === "string") headers[k] = v
	return headers
}

const asContentPart = (value: unknown): McpContentPartType | null =>
	typeof value === "object" && value !== null ? value : null

const scalarText = (value: unknown): string | null => {
	if (typeof value === "string") return value.trim() || null
	if (typeof value === "number" || typeof value === "boolean")
		return String(value)
	if (Array.isArray(value)) {
		const parts = value
			.map(scalarText)
			.filter((v): v is string => v !== null)
			.slice(0, 10)
		return parts.length > 0 ? parts.join(", ") : null
	}
	return null
}

const humanizeKey = (key: string): string =>
	key
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()

const structuredSummary = (structured: unknown): string | null => {
	const direct = scalarText(structured)
	if (direct !== null) return direct
	if (typeof structured !== "object" || structured === null) return null
	const entries = Object.entries(structured as Record<string, unknown>)
	const rendered: string[] = []
	for (const [key, value] of entries) {
		if (rendered.length >= 8) break
		const text = scalarText(value)
		if (text !== null) rendered.push(`${humanizeKey(key)}: ${text}`)
	}
	return rendered.length > 0 ? rendered.join(", ") : null
}

export const renderContent = (
	content: unknown,
	structured: unknown,
	context: { provider: string; tool: string },
): SkillRenderedContentType => {
	const modelParts: string[] = []
	const userParts: string[] = []
	let droppedParts = 0
	for (const raw of Array.isArray(content) ? content : []) {
		const part = asContentPart(raw)
		if (part?.type !== "text" || typeof part.text !== "string") {
			droppedParts++
			continue
		}
		const audience = part.annotations?.audience
		if (Array.isArray(audience)) {
			if (audience.includes("user")) userParts.push(part.text)
			if (audience.includes("assistant")) modelParts.push(part.text)
		} else {
			modelParts.push(part.text)
		}
	}
	if (droppedParts > 0)
		skillEngineLogger.warn("mcp non-text content parts dropped", {
			provider: context.provider,
			tool: context.tool,
			droppedParts,
		})
	const summary =
		structured === undefined ? null : structuredSummary(structured)
	const text =
		modelParts.length > 0
			? modelParts.join("\n")
			: userParts.length > 0
				? userParts.join("\n")
				: (summary ?? "")
	const speakableText =
		userParts.length > 0
			? userParts.join(" ")
			: modelParts.length > 0
				? null
				: summary
	return { text, speakableText, droppedParts }
}

export const validateElicitResult = (
	result: SkillElicitResultType,
	context: { provider: string },
): ValidatedElicitResultType => {
	const parsed = skillElicitResultSchema.safeParse(result)
	if (parsed.success) return parsed.data
	skillEngineLogger.warn("elicitation hook result rejected — declining", {
		provider: context.provider,
		issues: parsed.error.issues.length,
	})
	return { action: "decline" }
}

const resourceTextOf = (content: unknown): string | null =>
	content !== null &&
	typeof content === "object" &&
	"text" in content &&
	typeof content.text === "string"
		? content.text
		: null

const findDescriptorUri = async (
	source: ServerDescriptorSourceType,
): Promise<string | null> => {
	const seen = new Set<string>()
	let cursor: string | undefined
	for (let page = 0; page < DEFAULT_SKILL_MAX_LIST_PAGES; page++) {
		const listed = await source.listResources(cursor)
		if (listed.resources.some((r) => r.uri === SKILL_DESCRIPTOR_RESOURCE_URI))
			return SKILL_DESCRIPTOR_RESOURCE_URI
		const next = listed.nextCursor
		if (next === undefined || seen.has(next)) return null
		seen.add(next)
		cursor = next
	}
	return null
}

export const descriptorReaderOf =
	(provider: string, source: ServerDescriptorSourceType) =>
	async (knownTools?: SkillToolType[]): Promise<ServerDescriptorReadType> => {
		try {
			if (!source.hasResources()) return { status: "absent" }
			const uri = await findDescriptorUri(source)
			if (!uri) return { status: "absent" }
			const read = await source.readResource(uri)
			const text = read.contents.map(resourceTextOf).find((t) => t !== null)
			if (text === undefined) {
				skillEngineLogger.warn("server descriptor resource has no text", {
					provider,
					uri,
				})
				return { status: "invalid" }
			}
			const ingested = ingestServerDescriptorText(text, {
				provider,
				knownTools,
			})
			return ingested ? { status: "ok", ...ingested } : { status: "invalid" }
		} catch (error) {
			skillEngineLogger.warn("server descriptor read failed", {
				provider,
				message: error instanceof Error ? error.message : String(error),
			})
			return { status: "invalid" }
		}
	}

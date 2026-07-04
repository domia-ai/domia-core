import {
	SKILL_TOOL_NAME_SEPARATOR,
	DEFAULT_SKILL_MAX_RESULT_CHARS,
	type SelectSkillProviderType,
	type SkillToolType,
	type ToolFinalizeMapType,
	type ToolFinalizeRuleType,
} from "@/db"
import { skillEngineLogger, now } from "@/utils"
import type { DomiaType } from "@/modules/core"

import dbAdapter from "../db-adapter"
import { resolveSkillAdapter } from "../adapters"
import type {
	RawSkillToolType,
	SkillCallResultType,
	SkillConnectionType,
	SkillToolPolicyType,
} from "../types"

const connections = new Map<string, SkillConnectionType>()

const slugify = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "") || "skill"

const buildSlugMap = (
	providers: SelectSkillProviderType[],
): Map<string, string> => {
	const map = new Map<string, string>()
	const used = new Set<string>()
	for (const p of [...providers].sort((a, b) => (a.id < b.id ? -1 : 1))) {
		const base = slugify(p.name)
		let slug = base
		let n = 2
		while (used.has(slug)) slug = `${base}-${n++}`
		used.add(slug)
		map.set(p.id, slug)
	}
	return map
}

export const connectProvider = async (
	cfg: SelectSkillProviderType,
	slug: string,
): Promise<boolean> => {
	const adapter = resolveSkillAdapter(cfg.protocol)
	if (!adapter) {
		skillEngineLogger.warn("no adapter for protocol", {
			provider: cfg.name,
			protocol: cfg.protocol,
		})
		return false
	}
	try {
		const handle = await adapter.connect(cfg)
		connections.set(cfg.id, {
			providerId: cfg.id,
			providerSlug: slug,
			name: cfg.name,
			maxResultChars: cfg.maxResultChars ?? DEFAULT_SKILL_MAX_RESULT_CHARS,
			timeoutMs: cfg.timeout,
			allowedTools: new Set((cfg.toolsCache ?? []).map((t) => t.rawName)),
			toolPolicy: resolveToolPolicy(cfg.config),
			toolFinalize: resolveToolFinalizeMap(cfg.config),
			handle,
		})
		return true
	} catch (error) {
		skillEngineLogger.warn("skill connect failed", {
			provider: cfg.name,
			error,
		})
		return false
	}
}

export const connectAll = async (domia: DomiaType): Promise<void> => {
	const active = (domia.skillProviders ?? []).filter((s) => s.isActive)
	const slugMap = buildSlugMap(active)
	const toConnect = active.filter((s) => !connections.has(s.id))
	if (toConnect.length === 0) return
	await Promise.allSettled(
		toConnect.map((s) =>
			connectProvider(s, slugMap.get(s.id) ?? slugify(s.name)),
		),
	)
}

export const disconnectAll = async (): Promise<void> => {
	const all = [...connections.values()]
	connections.clear()
	await Promise.allSettled(all.map((c) => c.handle.close()))
}

export const disconnectProviders = async (ids: string[]): Promise<void> => {
	const closing: Promise<unknown>[] = []
	for (const id of ids) {
		const conn = connections.get(id)
		if (!conn) continue
		connections.delete(id)
		closing.push(conn.handle.close())
	}
	await Promise.allSettled(closing)
}

const resolveParamAllow = (
	config: unknown,
): Record<string, string[]> | null => {
	const raw = (config as { toolParamAllow?: unknown })?.toolParamAllow
	if (!raw || typeof raw !== "object") return null
	const out: Record<string, string[]> = {}
	for (const [k, v] of Object.entries(raw as Record<string, unknown>))
		if (Array.isArray(v)) out[k] = v.map((x) => String(x))
	return Object.keys(out).length ? out : null
}

const resolveToolPolicy = (config: unknown): SkillToolPolicyType | null => {
	const raw = (config as { toolPolicy?: unknown })?.toolPolicy
	if (!raw || typeof raw !== "object") return null
	const out: SkillToolPolicyType = {}
	for (const [k, v] of Object.entries(raw as Record<string, unknown>))
		if (v === "allow" || v === "block") out[k] = v
	return Object.keys(out).length ? out : null
}

const toFinalizeRule = (v: unknown): ToolFinalizeRuleType | null => {
	if (!v || typeof v !== "object") return null
	const o = v as Record<string, unknown>
	if (o.mode !== "agent_loop" && o.mode !== "template" && o.mode !== "async")
		return null
	const rule: ToolFinalizeRuleType = { mode: o.mode }
	if (typeof o.ack === "string") rule.ack = o.ack
	if (typeof o.error === "string") rule.error = o.error
	if (typeof o.done === "string") rule.done = o.done
	return rule
}

const resolveToolFinalizeMap = (
	config: unknown,
): ToolFinalizeMapType | null => {
	const raw = (config as { toolFinalize?: unknown })?.toolFinalize
	if (!raw || typeof raw !== "object") return null
	const out: ToolFinalizeMapType = {}
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		const rule = toFinalizeRule(v)
		if (rule) out[k] = rule
	}
	return Object.keys(out).length ? out : null
}

export const resolveToolFinalize = (
	namespacedName: string,
): ToolFinalizeRuleType | null => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	const providerSlug = sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : ""
	const rawName =
		sepIdx >= 0
			? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
			: namespacedName
	const conn = [...connections.values()].find(
		(c) => c.providerSlug === providerSlug && c.allowedTools.has(rawName),
	)
	if (!conn?.toolFinalize) return null
	return conn.toolFinalize[rawName] ?? conn.toolFinalize["*"] ?? null
}

const pruneSchemaParams = (
	schema: Record<string, unknown>,
	allow: string[],
): Record<string, unknown> => {
	const props = schema.properties as Record<string, unknown> | undefined
	if (!props) return schema
	const kept: Record<string, unknown> = {}
	for (const key of Object.keys(props))
		if (allow.includes(key)) kept[key] = props[key]
	const required = Array.isArray(schema.required)
		? (schema.required as string[]).filter((r) => allow.includes(r))
		: undefined
	return { ...schema, properties: kept, ...(required ? { required } : {}) }
}

const toCachedTools = (
	conn: SkillConnectionType,
	raw: RawSkillToolType[],
	whitelist: string[] | null,
	paramAllow: Record<string, string[]> | null,
): SkillToolType[] =>
	raw
		.filter((t) => !whitelist || whitelist.includes(t.name))
		.map((t) => {
			const schema = t.inputSchema ?? { type: "object", properties: {} }
			const allow = paramAllow?.[t.name] ?? paramAllow?.["*"]
			return {
				provider: conn.providerSlug,
				rawName: t.name,
				namespacedName: `${conn.providerSlug}${SKILL_TOOL_NAME_SEPARATOR}${t.name}`,
				description: t.description,
				inputSchema: allow ? pruneSchemaParams(schema, allow) : schema,
			}
		})

export const listTools = async (domia: DomiaType): Promise<SkillToolType[]> => {
	const providers = (domia.skillProviders ?? []).filter((s) => s.isActive)
	const result: SkillToolType[] = []
	for (const cfg of providers) {
		const conn = connections.get(cfg.id)
		if (!conn) {
			if (cfg.toolsCache?.length) result.push(...cfg.toolsCache)
			continue
		}
		try {
			const listed = await conn.handle.listTools()
			const tools = toCachedTools(
				conn,
				listed,
				cfg.toolWhitelist ?? null,
				resolveParamAllow(cfg.config),
			)
			conn.allowedTools = new Set(tools.map((t) => t.rawName))
			dbAdapter.cacheTools(cfg.id, tools, now()).run()
			result.push(...tools)
		} catch (error) {
			skillEngineLogger.warn("skill listTools failed — dropping connection", {
				provider: cfg.name,
				error,
			})
			connections.delete(cfg.id)
			void conn.handle.close().catch(() => undefined)
			if (cfg.toolsCache?.length) result.push(...cfg.toolsCache)
		}
	}
	return result
}

export const callTool = async (
	namespacedName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<SkillCallResultType> => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	const providerSlug = sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : ""
	const rawName =
		sepIdx >= 0
			? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
			: namespacedName
	const candidates = [...connections.values()].filter(
		(c) => c.providerSlug === providerSlug,
	)
	const conn = candidates.find((c) => c.allowedTools.has(rawName))
	if (!conn) {
		if (candidates.length > 0) {
			skillEngineLogger.warn("skill callTool rejected — tool not authorized", {
				tool: namespacedName,
			})
			return {
				text: `Tool "${rawName}" is not available.`,
				status: "unauthorized",
				isError: true,
			}
		}
		return {
			text: `Tool unavailable: ${providerSlug || "home"} is offline.`,
			status: "error",
			isError: true,
		}
	}
	const policy = conn.toolPolicy?.[rawName] ?? conn.toolPolicy?.["*"]
	if (policy === "block") {
		skillEngineLogger.warn("skill callTool blocked by policy", {
			tool: namespacedName,
		})
		return {
			text: `Action "${rawName}" is blocked by policy.`,
			status: "blocked",
			isError: true,
		}
	}
	try {
		const res = await conn.handle.callTool(rawName, args, signal)
		const truncated =
			res.text.length > conn.maxResultChars
				? `${res.text.slice(0, conn.maxResultChars)}…[truncated]`
				: res.text
		return {
			text: truncated || "(no output)",
			status: res.status,
			isError: res.isError,
		}
	} catch (error) {
		skillEngineLogger.warn("skill callTool failed", {
			tool: namespacedName,
			error,
		})
		return { text: `Tool "${rawName}" failed.`, status: "error", isError: true }
	}
}

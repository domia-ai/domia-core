import {
	SKILL_TOOL_NAME_SEPARATOR,
	DEFAULT_SKILL_REFRESH_MS,
	SKILL_TOOLS_TTL_FLOOR_MS,
	type SelectSkillProviderType,
	type SkillToolType,
	type ToolFinalizeRuleType,
} from "@/db"
import { skillEngineLogger, now } from "@/utils"
import type { DomiaType } from "@/modules/core"

import dbAdapter from "../db-adapter"
import { resolveDescriptor } from "../utils/descriptor"
import { normalizeArgs } from "../utils/arg-normalize"
import { toolBaseName, toolsFreshUntil } from "../utils"
import type {
	RawSkillToolType,
	SkillConnectionType,
	SkillProviderStatusType,
	SkillToolStatusType,
	ListToolsOptionsType,
} from "../types"

import { connections } from "./state"
import { buildToolMeta } from "./registry"
import { fireOnDisconnected, syncServerDescriptor } from "./connections"
import { isBuiltinProvider } from "./providers"

export const resolveToolFinalize = (
	domiaId: string,
	namespacedName: string,
): ToolFinalizeRuleType | null => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	const providerSlug = sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : ""
	const rawName =
		sepIdx >= 0
			? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
			: namespacedName
	const conn = [...connections.values()].find(
		(c) =>
			c.provider.domiaId === domiaId &&
			c.providerSlug === providerSlug &&
			c.allowedTools.has(rawName),
	)
	if (!conn) return null
	return (
		conn.descriptor.finalize[rawName] ??
		conn.descriptor.finalize[toolBaseName(rawName)] ??
		conn.descriptor.finalize["*"] ??
		null
	)
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
	paramAllow: Record<string, string[]> | null,
): SkillToolType[] =>
	raw.map((t) => {
		const schema = t.inputSchema ?? { type: "object", properties: {} }
		const allow = paramAllow?.[t.name] ?? paramAllow?.["*"]
		return {
			provider: conn.providerSlug,
			rawName: t.name,
			namespacedName: `${conn.providerSlug}${SKILL_TOOL_NAME_SEPARATOR}${t.name}`,
			description: t.description,
			inputSchema: allow ? pruneSchemaParams(schema, allow) : schema,
			...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
			...(t.annotations ? { annotations: t.annotations } : {}),
		}
	})

const advertisedRawTools = (
	conn: SkillConnectionType,
	listed: RawSkillToolType[],
	whitelist: string[] | null,
): RawSkillToolType[] => {
	const remote = whitelist
		? listed.filter((t) => whitelist.includes(t.name))
		: listed
	const virtual = conn.specialization?.virtualTools?.(
		conn.provider,
		conn.language,
	)
	if (!virtual || virtual.length === 0) return remote
	const remoteNames = new Set(remote.map((t) => t.name))
	return [...remote, ...virtual.filter((t) => !remoteNames.has(t.name))]
}

const toolStatuses = (
	conn: SkillConnectionType | undefined,
): SkillToolStatusType[] => {
	if (!conn) return []
	const hidden = new Set(conn.descriptor.hiddenTools)
	return [...conn.toolMeta.values()].map((m) => ({
		rawName: m.rawName,
		namespacedName: `${conn.providerSlug}${SKILL_TOOL_NAME_SEPARATOR}${m.rawName}`,
		riskClass: m.riskClass,
		policy: m.policy,
		policySource: m.policySource,
		retryable: m.idempotent,
		openWorld: m.openWorld,
		hidden: hidden.has(m.rawName) || hidden.has(toolBaseName(m.rawName)),
		hintSources: m.hintSources,
	}))
}

export const nextToolsRefreshMs = (domia: DomiaType): number => {
	const candidates = (domia.skillProviders ?? [])
		.filter((cfg) => cfg.isActive)
		.map((cfg) => cfg.toolsRefreshMs)
	if (candidates.length === 0) return DEFAULT_SKILL_REFRESH_MS
	return Math.max(SKILL_TOOLS_TTL_FLOOR_MS, Math.min(...candidates))
}

export const providerStatuses = (
	domia: DomiaType,
): SkillProviderStatusType[] => {
	const language = domia.characterProfile?.language ?? null
	return (domia.skillProviders ?? [])
		.filter((cfg) => cfg.isActive)
		.map((cfg) => {
			const conn = connections.get(cfg.id)
			return {
				id: cfg.id,
				name: cfg.name,
				kind: (conn?.descriptor ?? resolveDescriptor(cfg, language)).kind,
				trustTier: cfg.trustTier,
				connected: conn !== undefined,
				cachedTools: cfg.toolsCache?.length ?? 0,
				allowedTools: conn?.allowedTools.size ?? 0,
				lastSyncAt: cfg.lastSyncAt ?? null,
				toolsFreshUntil: conn?.toolsFreshUntil
					? new Date(conn.toolsFreshUntil).toISOString()
					: null,
				toolsRefreshMs: cfg.toolsRefreshMs,
				protocolEra: conn?.handle.protocolEra?.() ?? null,
				tools: toolStatuses(conn),
				specialization: conn?.specialization?.status?.(conn.provider) ?? null,
			}
		})
}

const cacheIsFresh = (conn: SkillConnectionType): boolean =>
	conn.toolsFreshUntil !== null && Date.now() < conn.toolsFreshUntil

export const listTools = async (
	domia: DomiaType,
	opts: ListToolsOptionsType = {},
): Promise<SkillToolType[]> => {
	const providers = (domia.skillProviders ?? [])
		.filter(
			(s) =>
				s.isActive && (!opts.providerIds || opts.providerIds.includes(s.id)),
		)
		.sort((a, b) => Number(isBuiltinProvider(a)) - Number(isBuiltinProvider(b)))
	const language = domia.characterProfile?.language ?? null
	const result: SkillToolType[] = []
	const staleTools = (cfg: SelectSkillProviderType): SkillToolType[] => {
		const cached = cfg.toolsCache ?? []
		if (cached.length === 0) return []
		if (resolveDescriptor(cfg, language).resilience.serveStaleTools)
			return cached
		skillEngineLogger.warn(
			"skill provider disconnected — cached tools withheld until it reconnects",
			{ provider: cfg.name, cachedTools: cached.length },
		)
		return []
	}
	for (const cfg of providers) {
		const conn = connections.get(cfg.id)
		if (!conn) {
			result.push(...staleTools(cfg))
			continue
		}
		if (!opts.force && cacheIsFresh(conn)) {
			skillEngineLogger.debug("skill tool list served from cache", {
				provider: cfg.name,
				refreshMs: cfg.toolsRefreshMs,
			})
			result.push(...(conn.provider.toolsCache ?? []))
			continue
		}
		try {
			const listed = await conn.handle.listTools()
			const paramAllow = conn.descriptor.paramAllow
			const tools = toCachedTools(
				conn,
				advertisedRawTools(conn, listed.tools, cfg.toolWhitelist ?? null),
				Object.keys(paramAllow).length ? paramAllow : null,
			)
			conn.allowedTools = new Set(tools.map((t) => t.rawName))
			const syncedAt = now()
			dbAdapter.cacheTools(cfg.id, tools, syncedAt).run()
			conn.toolsFreshUntil = toolsFreshUntil(cfg.toolsRefreshMs, listed.ttlMs)
			conn.provider = await syncServerDescriptor(
				{
					...cfg,
					serverDescriptor: conn.provider.serverDescriptor,
					serverDescriptorHash: conn.provider.serverDescriptorHash,
					toolsCache: tools,
					lastSyncAt: syncedAt,
				},
				conn.handle,
			)
			conn.descriptor = resolveDescriptor(conn.provider, conn.language)
			conn.toolMeta = buildToolMeta(tools, conn.descriptor, cfg.trustTier)
			result.push(...tools)
		} catch (error) {
			skillEngineLogger.warn("skill listTools failed — dropping connection", {
				provider: cfg.name,
				error,
			})
			connections.delete(cfg.id)
			fireOnDisconnected(conn)
			void conn.handle.close().catch((err: unknown) =>
				skillEngineLogger.warn("skill connection close failed after drop", {
					provider: cfg.name,
					err,
				}),
			)
			result.push(...staleTools(cfg))
		}
	}
	return result
}

export const resolveSkillArgs = async (
	domiaId: string,
	namespacedName: string,
	args: Record<string, unknown>,
): Promise<{
	ok: boolean
	resolvedArgs: Record<string, unknown>
	error?: string
}> => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	const providerSlug = sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : ""
	const rawName =
		sepIdx >= 0
			? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
			: namespacedName
	const conn = [...connections.values()].find(
		(c) =>
			c.provider.domiaId === domiaId &&
			c.providerSlug === providerSlug &&
			c.allowedTools.has(rawName),
	)
	if (!conn) return { ok: false, resolvedArgs: args, error: "tool unavailable" }
	const normalized = normalizeArgs(conn.descriptor.argNormalize, rawName, args)
	if (!conn.specialization?.resolveArgs)
		return { ok: true, resolvedArgs: normalized }
	try {
		const resolvedArgs = await conn.specialization.resolveArgs(
			conn.provider,
			rawName,
			normalized,
			conn.language,
		)
		return { ok: true, resolvedArgs }
	} catch (error) {
		return {
			ok: false,
			resolvedArgs: normalized,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

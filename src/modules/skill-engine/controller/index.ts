import {
	SKILL_TOOL_NAME_SEPARATOR,
	DEFAULT_SKILL_MAX_RESULT_CHARS,
	type SelectSkillProviderType,
	type SkillToolType,
	type ToolFinalizeRuleType,
	type ToolPolicyType,
} from "@/db"
import { skillEngineLogger, now } from "@/utils"
import type { DomiaType } from "@/modules/core"

import dbAdapter from "../db-adapter"
import { resolveSkillAdapter } from "../adapters"
import { resolveSpecialization } from "../specializations"
import { resolveDescriptor } from "../utils/descriptor"
import {
	breakerOpen,
	recordBreakerResult,
	isTransientStatus,
	backoffDelay,
	sleep,
} from "../utils/resilience"
import type {
	RawSkillToolType,
	SkillCallResultType,
	SkillConnectionType,
	ResolvedSkillResilienceType,
} from "../types"

const connections = new Map<string, SkillConnectionType>()

const findConn = (
	domiaId: string,
	providerSlug: string,
): SkillConnectionType | undefined =>
	[...connections.values()].find(
		(c) => c.provider.domiaId === domiaId && c.providerSlug === providerSlug,
	)

export const getProviderResilience = (
	domiaId: string,
	providerSlug: string,
): ResolvedSkillResilienceType | null =>
	findConn(domiaId, providerSlug)?.descriptor.resilience ?? null

export const getToolPolicy = (
	domiaId: string,
	namespacedName: string,
): ToolPolicyType => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	const providerSlug = sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : ""
	const rawName =
		sepIdx >= 0
			? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
			: namespacedName
	const conn = findConn(domiaId, providerSlug)
	if (!conn) return "allow"
	return (
		conn.descriptor.toolPolicy[rawName] ??
		conn.descriptor.toolPolicy["*"] ??
		"allow"
	)
}

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
	language: string | null = null,
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
		const specialization = resolveSpecialization(cfg)
		if (specialization?.onConnected)
			void Promise.resolve(specialization.onConnected(cfg, handle)).catch(
				(err) =>
					skillEngineLogger.warn("specialization onConnected failed", {
						provider: cfg.name,
						err,
					}),
			)
		connections.set(cfg.id, {
			providerId: cfg.id,
			providerSlug: slug,
			name: cfg.name,
			maxResultChars: cfg.maxResultChars ?? DEFAULT_SKILL_MAX_RESULT_CHARS,
			timeoutMs: cfg.timeout,
			allowedTools: new Set((cfg.toolsCache ?? []).map((t) => t.rawName)),
			descriptor: resolveDescriptor(cfg, language),
			language,
			provider: cfg,
			specialization,
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
	const activeIds = new Set(active.map((s) => s.id))
	const stale = [...connections.values()]
		.filter(
			(c) => c.provider.domiaId === domia.id && !activeIds.has(c.providerId),
		)
		.map((c) => c.providerId)
	if (stale.length > 0) {
		skillEngineLogger.info(`disconnecting ${stale.length} stale provider(s)`, {
			domiaId: domia.id,
		})
		await disconnectProviders(stale)
	}
	const slugMap = buildSlugMap(active)
	const toConnect = active.filter((s) => !connections.has(s.id))
	if (toConnect.length === 0) return
	const language = domia.characterProfile?.language ?? null
	await Promise.allSettled(
		toConnect.map((s) =>
			connectProvider(s, slugMap.get(s.id) ?? slugify(s.name), language),
		),
	)
}

const fireOnDisconnected = (conn: SkillConnectionType): void => {
	const hook = conn.specialization?.onDisconnected
	if (!hook) return
	void (async () => hook(conn.provider))().catch((err) =>
		skillEngineLogger.warn("specialization onDisconnected failed", {
			provider: conn.name,
			err,
		}),
	)
}

export const disconnectAll = async (): Promise<void> => {
	const all = [...connections.values()]
	connections.clear()
	for (const conn of all) fireOnDisconnected(conn)
	await Promise.allSettled(all.map((c) => c.handle.close()))
}

export const disconnectProviders = async (ids: string[]): Promise<void> => {
	const closing: Promise<unknown>[] = []
	for (const id of ids) {
		const conn = connections.get(id)
		if (!conn) continue
		connections.delete(id)
		fireOnDisconnected(conn)
		closing.push(conn.handle.close())
	}
	await Promise.allSettled(closing)
}

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
		conn.descriptor.finalize[rawName] ?? conn.descriptor.finalize["*"] ?? null
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
			const paramAllow = conn.descriptor.paramAllow
			const tools = toCachedTools(
				conn,
				listed,
				cfg.toolWhitelist ?? null,
				Object.keys(paramAllow).length ? paramAllow : null,
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
			fireOnDisconnected(conn)
			void conn.handle.close().catch(() => undefined)
			if (cfg.toolsCache?.length) result.push(...cfg.toolsCache)
		}
	}
	return result
}

export const callTool = async (
	domiaId: string,
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
	const breakerKey = `${domiaId}:${providerSlug}`
	const candidates = [...connections.values()].filter(
		(c) => c.provider.domiaId === domiaId && c.providerSlug === providerSlug,
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
				resolvedArgs: args,
			}
		}
		return {
			text: `Tool unavailable: ${providerSlug || "home"} is offline.`,
			status: "error",
			isError: true,
			resolvedArgs: args,
		}
	}
	const policy =
		conn.descriptor.toolPolicy[rawName] ?? conn.descriptor.toolPolicy["*"]
	if (policy === "block") {
		skillEngineLogger.warn("skill callTool blocked by policy", {
			tool: namespacedName,
		})
		return {
			text: `Action "${rawName}" is blocked by policy.`,
			status: "blocked",
			isError: true,
			resolvedArgs: args,
		}
	}
	const {
		retryMaxAttempts,
		retryBackoffMs,
		breakerThreshold,
		breakerCooldownMs,
	} = conn.descriptor.resilience
	if (breakerOpen(breakerKey, breakerThreshold)) {
		skillEngineLogger.warn("skill callTool short-circuited — breaker open", {
			tool: namespacedName,
		})
		return {
			text: `Service "${providerSlug || "home"}" is temporarily unavailable.`,
			status: "error",
			isError: true,
			resolvedArgs: args,
		}
	}
	let resolvedArgs: Record<string, unknown>
	try {
		resolvedArgs = conn.specialization?.resolveArgs
			? await conn.specialization.resolveArgs(
					conn.provider,
					rawName,
					args,
					conn.language,
				)
			: args
	} catch (error) {
		skillEngineLogger.warn("skill callTool resolveArgs failed", {
			tool: namespacedName,
			error,
		})
		return {
			text: `Tool "${rawName}" failed.`,
			status: "error",
			isError: true,
			resolvedArgs: args,
		}
	}
	skillEngineLogger.info(`🔧 ${rawName} ${JSON.stringify(resolvedArgs)}`)

	let transportError: unknown = null
	for (let attempt = 0; attempt < Math.max(1, retryMaxAttempts); attempt++) {
		if (attempt > 0) {
			skillEngineLogger.warn(
				`skill callTool transient — retry ${attempt}/${retryMaxAttempts - 1}`,
				{ tool: namespacedName },
			)
			await sleep(backoffDelay(attempt, retryBackoffMs), signal)
		}
		if (signal?.aborted) break
		try {
			const res = await conn.handle.callTool(rawName, resolvedArgs, signal)
			if (isTransientStatus(res.status)) {
				transportError = null
				continue
			}
			recordBreakerResult(breakerKey, true, breakerThreshold, breakerCooldownMs)
			const truncated =
				res.text.length > conn.maxResultChars
					? `${res.text.slice(0, conn.maxResultChars)}…[truncated]`
					: res.text
			return {
				text: truncated || "(no output)",
				status: res.status,
				isError: res.isError,
				resolvedArgs,
			}
		} catch (error) {
			transportError = error
			if (signal?.aborted) break
		}
	}

	if (signal?.aborted) {
		skillEngineLogger.info("skill callTool cancelled by caller", {
			tool: namespacedName,
		})
		return {
			text: `Tool "${rawName}" was cancelled.`,
			status: "timeout",
			isError: true,
			resolvedArgs,
		}
	}
	recordBreakerResult(breakerKey, false, breakerThreshold, breakerCooldownMs)
	skillEngineLogger.warn("skill callTool failed", {
		tool: namespacedName,
		error: transportError,
	})
	return {
		text: `Tool "${rawName}" failed.`,
		status: "error",
		isError: true,
		resolvedArgs,
	}
}

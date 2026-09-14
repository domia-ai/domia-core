import {
	DEFAULT_PROVIDER_DISCOVERY_MS,
	type SelectSkillProviderType,
} from "@/db"
import { skillEngineLogger, domiaError, SKILL_ERRORS } from "@/utils"
import type { DomiaType } from "@/modules/core"

import { resolveSkillAdapter } from "../adapters"
import { resolveSpecialization, listSpecializations } from "../specializations"
import { resolveDescriptor } from "../utils/descriptor"
import type { SkillConnectionType, DiscoveredProviderType } from "../types"

import { connections } from "./state"
import { buildToolMeta } from "./registry"
import { connHooksFor } from "./hooks"

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

const openConnection = async (
	cfg: SelectSkillProviderType,
	slug: string,
	language: string | null,
): Promise<SkillConnectionType> => {
	const adapter = resolveSkillAdapter(cfg.protocol, cfg.type)
	if (!adapter)
		throw domiaError(SKILL_ERRORS.INVALID_PROVIDER_CONFIG, {
			logger: skillEngineLogger,
			meta: { provider: cfg.name, protocol: cfg.protocol, type: cfg.type },
		})
	const handle = await adapter
		.connect(cfg, connHooksFor(cfg))
		.catch((error: unknown) => {
			throw domiaError(SKILL_ERRORS.PROVIDER_NOT_READY, {
				logger: skillEngineLogger,
				meta: {
					provider: cfg.name,
					url: cfg.url,
					message: error instanceof Error ? error.message : String(error),
				},
			})
		})
	const descriptor = resolveDescriptor(cfg, language)
	return {
		providerId: cfg.id,
		providerSlug: slug,
		name: cfg.name,
		maxResultChars: cfg.maxResultChars,
		timeoutMs: cfg.timeout,
		allowedTools: new Set((cfg.toolsCache ?? []).map((t) => t.rawName)),
		descriptor,
		toolMeta: buildToolMeta(cfg.toolsCache ?? [], descriptor, cfg.trustTier),
		toolsFreshUntil: null,
		language,
		provider: cfg,
		specialization: resolveSpecialization(cfg),
		handle,
	}
}

const fireOnConnected = (conn: SkillConnectionType): void => {
	const hook = conn.specialization?.onConnected
	if (!hook) return
	void Promise.resolve(hook(conn.provider, conn.handle)).catch((err: unknown) =>
		skillEngineLogger.warn("specialization onConnected failed", {
			provider: conn.name,
			err,
		}),
	)
}

export const connectProvider = async (
	cfg: SelectSkillProviderType,
	slug: string,
	language: string | null = null,
): Promise<boolean> => {
	try {
		const conn = await openConnection(cfg, slug, language)
		connections.set(cfg.id, conn)
		fireOnConnected(conn)
		return true
	} catch {
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

export const fireOnDisconnected = (conn: SkillConnectionType): void => {
	const hook = conn.specialization?.onDisconnected
	if (!hook) return
	void (async () => hook(conn.provider))().catch((err: unknown) =>
		skillEngineLogger.warn("specialization onDisconnected failed", {
			provider: conn.name,
			err,
		}),
	)
}

const swapConnection = async (conn: SkillConnectionType): Promise<void> => {
	const previous = connections.get(conn.providerId)
	connections.set(conn.providerId, conn)
	if (previous) {
		fireOnDisconnected(previous)
		await previous.handle.close().catch((err: unknown) =>
			skillEngineLogger.warn("replaced skill connection close failed", {
				provider: previous.name,
				err,
			}),
		)
	}
	fireOnConnected(conn)
}

export const reconnectProviders = async (
	domia: DomiaType,
	providerIds: string[],
): Promise<void> => {
	const active = (domia.skillProviders ?? []).filter((s) => s.isActive)
	const targets = active.filter((s) => providerIds.includes(s.id))
	if (targets.length === 0) return
	const slugMap = buildSlugMap(active)
	const language = domia.characterProfile?.language ?? null
	const candidates: SkillConnectionType[] = []
	const errors: unknown[] = []
	await Promise.all(
		targets.map(async (cfg) => {
			try {
				candidates.push(
					await openConnection(
						cfg,
						slugMap.get(cfg.id) ?? slugify(cfg.name),
						language,
					),
				)
			} catch (error) {
				errors.push(error)
			}
		}),
	)
	if (errors.length > 0) {
		await Promise.allSettled(candidates.map((c) => c.handle.close()))
		throw errors[0]
	}
	skillEngineLogger.info("🧩 swapping skill connections", {
		domiaId: domia.id,
		count: candidates.length,
	})
	for (const conn of candidates) await swapConnection(conn)
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

export const discoverProviders = async (
	timeoutMs: number = DEFAULT_PROVIDER_DISCOVERY_MS,
): Promise<DiscoveredProviderType[]> => {
	const found = await Promise.all(
		listSpecializations().map((spec) =>
			spec.discover
				? spec.discover(timeoutMs).catch((err: unknown) => {
						skillEngineLogger.warn("provider discovery failed", {
							kind: spec.kind,
							err,
						})
						return []
					})
				: Promise.resolve([]),
		),
	)
	return found.flat()
}

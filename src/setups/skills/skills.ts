import { skillEngineLogger, createKeyedMutex } from "@/utils"
import { type DomiaType, invalidateOwnDomia } from "@/modules/core"
import type { SelectSkillProviderType } from "@/db"
import {
	connectAll,
	reconnectProviders,
	listTools,
	disconnectProviders,
	markDispatchedToolRunsLost,
	setSkillsRefreshHook,
	clearSkillsRefreshHook,
	nextToolsRefreshMs,
	type SkillsRefreshOptionsType,
	setElicitationPresenter,
	clearElicitationPresenter,
	isBuiltinProvider,
} from "@/modules/skill-engine"
import { rehydrateConfirmations } from "@/modules/agent"
import { presentElicit } from "@/modules/core-bus"

import { installSkillRuntimePort } from "./runtime-port"
import type { McpSetupHandleType } from "./types"

const skillHandles = new Map<string, McpSetupHandleType>()
const appliedProviders = new Map<string, Map<string, string>>()
const setupMutex = createKeyedMutex()

const connectionFingerprint = (
	cfg: SelectSkillProviderType,
	language: string | null,
): string =>
	JSON.stringify([
		cfg.protocol,
		cfg.type,
		cfg.name,
		cfg.url,
		cfg.isActive,
		cfg.auth,
		cfg.config,
		cfg.timeout,
		cfg.maxResultChars,
		cfg.trustTier,
		cfg.descriptor,
		cfg.toolWhitelist,
		cfg.priority,
		language,
	])

const mcpSkillsOn = (domia: DomiaType): boolean =>
	domia.moduleSettings?.skillsEngine === true

const builtinToolsOn = (domia: DomiaType): boolean =>
	domia.moduleSettings?.builtinTools === true

const connectableProviders = (domia: DomiaType): SelectSkillProviderType[] =>
	(domia.skillProviders ?? []).filter(
		(s) =>
			s.isActive &&
			(isBuiltinProvider(s) ? builtinToolsOn(domia) : mcpSkillsOn(domia)),
	)

const changedProviders = (domia: DomiaType): SelectSkillProviderType[] => {
	const applied = appliedProviders.get(domia.domiaKey)
	if (!applied) return []
	const language = domia.characterProfile?.language ?? null
	return connectableProviders(domia).filter(
		(cfg) =>
			applied.has(cfg.id) &&
			applied.get(cfg.id) !== connectionFingerprint(cfg, language),
	)
}

const rememberProviders = (domia: DomiaType): void => {
	const language = domia.characterProfile?.language ?? null
	appliedProviders.set(
		domia.domiaKey,
		new Map(
			connectableProviders(domia).map((s) => [
				s.id,
				connectionFingerprint(s, language),
			]),
		),
	)
}

let lostSweepDone = false
let confirmationsRehydrated = false
const REHYDRATE_RETRY_MS = 30_000

let rehydrationInFlight: Promise<void> | null = null
let rehydrateRetryTimer: ReturnType<typeof setTimeout> | null = null

const ensureConfirmationsRehydrated = (): Promise<void> => {
	if (confirmationsRehydrated) return Promise.resolve()
	if (rehydrationInFlight) return rehydrationInFlight
	rehydrationInFlight = rehydrateConfirmations()
		.then(() => {
			confirmationsRehydrated = true
		})
		.catch((err: unknown) => {
			skillEngineLogger.warn(
				`confirmation rehydration failed — retrying in ${REHYDRATE_RETRY_MS}ms`,
				{ err },
			)
			if (!rehydrateRetryTimer) {
				rehydrateRetryTimer = setTimeout(() => {
					rehydrateRetryTimer = null
					void ensureConfirmationsRehydrated()
				}, REHYDRATE_RETRY_MS)
				if (typeof rehydrateRetryTimer.unref === "function")
					rehydrateRetryTimer.unref()
			}
		})
		.finally(() => {
			rehydrationInFlight = null
		})
	return rehydrationInFlight
}

const setupSkillsLocked = async (
	domia: DomiaType,
): Promise<McpSetupHandleType | null> => {
	installSkillRuntimePort(domia)
	if (!lostSweepDone) {
		lostSweepDone = true
		markDispatchedToolRunsLost()
	}
	if (!confirmationsRehydrated) await ensureConfirmationsRehydrated()
	const servers = connectableProviders(domia)
	rememberProviders(domia)
	skillHandles.get(domia.domiaKey)?.stopTimers()
	skillHandles.delete(domia.domiaKey)
	if (servers.length === 0) {
		await connectAll(domia, [])
		skillEngineLogger.info("🧩 Skills disabled — no providers connected")
		return null
	}

	skillEngineLogger.info("🧩 Connecting skill providers", {
		count: servers.length,
		mcp: mcpSkillsOn(domia),
		builtin: builtinToolsOn(domia),
	})
	const providerIds = servers.map((s) => s.id)
	await connectAll(domia, servers)
	const tools = await listTools(domia, { providerIds })
	invalidateOwnDomia(domia.domiaKey)
	skillEngineLogger.info("🧩 Skill tools available", { count: tools.length })

	let refreshTimer: ReturnType<typeof setTimeout> | null = null
	let stopped = false
	const scheduleNext = (): void => {
		if (stopped) return
		if (refreshTimer) clearTimeout(refreshTimer)
		refreshTimer = setTimeout(
			() => refresh({ force: false }),
			nextToolsRefreshMs(domia),
		)
		if (typeof refreshTimer.unref === "function") refreshTimer.unref()
	}
	const refresh = (opts: SkillsRefreshOptionsType): void => {
		void connectAll(domia, servers)
			.then(() => listTools(domia, { ...opts, providerIds }))
			.then(() => invalidateOwnDomia(domia.domiaKey))
			.catch((err: unknown) =>
				skillEngineLogger.warn("skill refresh/reconnect failed", { err }),
			)
			.finally(scheduleNext)
	}
	scheduleNext()
	setSkillsRefreshHook(domia.id, refresh)
	setElicitationPresenter(domia.id, (message, requestedSchema) =>
		presentElicit(domia, message, requestedSchema),
	)

	const stopTimers = (): void => {
		stopped = true
		if (refreshTimer) clearTimeout(refreshTimer)
		clearSkillsRefreshHook(domia.id)
		clearElicitationPresenter(domia.id)
	}
	const handle: McpSetupHandleType = {
		stopTimers,
		stop: async () => {
			stopTimers()
			await disconnectProviders(providerIds)
		},
	}
	skillHandles.set(domia.domiaKey, handle)
	return handle
}

export const setupSkills = (
	domia: DomiaType,
): Promise<McpSetupHandleType | null> =>
	setupMutex(domia.domiaKey, () => setupSkillsLocked(domia))

export const stopSkills = (domiaKey: string): Promise<void> =>
	setupMutex(domiaKey, async () => {
		const handle = skillHandles.get(domiaKey)
		skillHandles.delete(domiaKey)
		appliedProviders.delete(domiaKey)
		if (handle) await handle.stop()
	})

export const reloadSkills = (domia: DomiaType): Promise<void> =>
	setupMutex(domia.domiaKey, async () => {
		const changed = changedProviders(domia)
		if (changed.length > 0)
			await reconnectProviders(
				domia,
				changed.map((c) => c.id),
			)
		await setupSkillsLocked(domia)
	})

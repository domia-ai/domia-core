import { skillEngineLogger } from "@/utils"
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
} from "@/modules/skill-engine"
import { rehydrateConfirmations } from "@/modules/agent"
import { presentElicit } from "@/modules/core-bus"

import type { McpSetupHandleType } from "./types"

const skillHandles = new Map<string, McpSetupHandleType>()
const appliedProviders = new Map<string, Map<string, string>>()

const connectionFingerprint = (
	cfg: SelectSkillProviderType,
	language: string | null,
): string =>
	JSON.stringify([
		cfg.protocol,
		cfg.type,
		cfg.url,
		cfg.isActive,
		cfg.auth,
		cfg.config,
		cfg.timeout,
		cfg.trustTier,
		cfg.descriptor,
		language,
	])

const activeProviders = (domia: DomiaType): SelectSkillProviderType[] =>
	(domia.skillProviders ?? []).filter((s) => s.isActive)

const changedProviders = (domia: DomiaType): SelectSkillProviderType[] => {
	const applied = appliedProviders.get(domia.domiaKey)
	if (!applied) return []
	const language = domia.characterProfile?.language ?? null
	return activeProviders(domia).filter(
		(cfg) => applied.get(cfg.id) !== connectionFingerprint(cfg, language),
	)
}

const rememberProviders = (domia: DomiaType): void => {
	const language = domia.characterProfile?.language ?? null
	appliedProviders.set(
		domia.domiaKey,
		new Map(
			activeProviders(domia).map((s) => [
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

export const setupSkills = async (
	domia: DomiaType,
): Promise<McpSetupHandleType | null> => {
	if (!lostSweepDone) {
		lostSweepDone = true
		markDispatchedToolRunsLost()
	}
	if (!confirmationsRehydrated) await ensureConfirmationsRehydrated()
	const skillsOn = domia.moduleSettings?.skillsEngine === true
	const servers = activeProviders(domia)
	rememberProviders(domia)
	if (!skillsOn || servers.length === 0) {
		skillHandles.delete(domia.domiaKey)
		skillEngineLogger.info("🧩 Skills disabled — no providers connected")
		return null
	}

	skillEngineLogger.info("🧩 Connecting skill providers", {
		count: servers.length,
	})
	await connectAll(domia)
	const tools = await listTools(domia)
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
		void connectAll(domia)
			.then(() => listTools(domia, opts))
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

	const providerIds = servers.map((s) => s.id)
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

export const stopSkills = async (domiaKey: string): Promise<void> => {
	const handle = skillHandles.get(domiaKey)
	skillHandles.delete(domiaKey)
	appliedProviders.delete(domiaKey)
	if (handle) await handle.stop()
}

export const reloadSkills = async (domia: DomiaType): Promise<void> => {
	if (domia.moduleSettings?.skillsEngine !== true) {
		await stopSkills(domia.domiaKey)
		return
	}
	const changed = changedProviders(domia)
	if (changed.length > 0)
		await reconnectProviders(
			domia,
			changed.map((c) => c.id),
		)
	skillHandles.get(domia.domiaKey)?.stopTimers()
	skillHandles.delete(domia.domiaKey)
	await setupSkills(domia)
}

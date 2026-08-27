import { DEFAULT_SKILL_REFRESH_MS } from "@/db"
import { skillEngineLogger } from "@/utils"
import { type DomiaType, invalidateOwnDomia } from "@/modules/core"
import {
	connectAll,
	listTools,
	disconnectProviders,
	markDispatchedToolRunsLost,
	setSkillsRefreshHook,
	clearSkillsRefreshHook,
	setElicitationPresenter,
	clearElicitationPresenter,
} from "@/modules/skill-engine"
import { rehydrateConfirmations } from "@/modules/agent"
import { presentElicit } from "@/modules/core-bus"

import type { McpSetupHandleType } from "./types"

const skillHandles = new Map<string, McpSetupHandleType>()

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
		.catch((err) => {
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
	const servers = (domia.skillProviders ?? []).filter((s) => s.isActive)
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

	const refresh = (): void => {
		void connectAll(domia)
			.then(() => listTools(domia))
			.then(() => invalidateOwnDomia(domia.domiaKey))
			.catch((err) =>
				skillEngineLogger.warn("skill refresh/reconnect failed", { err }),
			)
	}
	const interval = setInterval(refresh, DEFAULT_SKILL_REFRESH_MS)
	if (typeof interval.unref === "function") interval.unref()
	setSkillsRefreshHook(domia.id, refresh)
	setElicitationPresenter(domia.id, (message, requestedSchema) =>
		presentElicit(domia, message, requestedSchema),
	)

	const providerIds = servers.map((s) => s.id)
	const handle: McpSetupHandleType = {
		stop: async () => {
			clearInterval(interval)
			clearSkillsRefreshHook(domia.id)
			clearElicitationPresenter(domia.id)
			await disconnectProviders(providerIds)
		},
	}
	skillHandles.set(domia.domiaKey, handle)
	return handle
}

export const stopSkills = async (domiaKey: string): Promise<void> => {
	const handle = skillHandles.get(domiaKey)
	skillHandles.delete(domiaKey)
	if (handle) await handle.stop()
}

export const reloadSkills = async (domia: DomiaType): Promise<void> => {
	await stopSkills(domia.domiaKey)
	await setupSkills(domia)
}

import { DEFAULT_SKILL_REFRESH_MS } from "@/db"
import { skillEngineLogger } from "@/utils"
import { type DomiaType, invalidateOwnDomia } from "@/modules/core"
import { connectAll, listTools, disconnectAll } from "@/modules/skill-engine"

export type McpSetupHandleType = {
	stop: () => Promise<void>
}

const skillHandles = new Map<string, McpSetupHandleType>()

export const setupSkills = async (
	domia: DomiaType,
): Promise<McpSetupHandleType | null> => {
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
	invalidateOwnDomia()
	skillEngineLogger.info("🧩 Skill tools available", { count: tools.length })

	const interval = setInterval(() => {
		void connectAll(domia)
			.then(() => listTools(domia))
			.then(() => invalidateOwnDomia())
			.catch((err) =>
				skillEngineLogger.warn("skill refresh/reconnect failed", { err }),
			)
	}, DEFAULT_SKILL_REFRESH_MS)
	if (typeof interval.unref === "function") interval.unref()

	const handle: McpSetupHandleType = {
		stop: async () => {
			clearInterval(interval)
			await disconnectAll()
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

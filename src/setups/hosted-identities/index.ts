import { appLogger } from "@/utils"
import {
	type DomiaType,
	getDomia,
	getHostedDomias,
	registerHostedIdentity,
	unregisterHostedIdentity,
	isHostedIdentity,
} from "@/modules/core"
import { abortActiveTurn } from "@/modules/core-bus"
import { initialize, DEFAULT_CONFIG_VALUES } from "@/modules/config-engine"
import { warmupOnBoot } from "@/modules/warmup"
import { setupCoreBus, teardownCoreBus } from "@/setups/core-bus"
import { setupSkills, stopSkills } from "@/setups/skills"
import { setupHeartbeat } from "@/setups/heartbeat"
import { stopVoiceListener } from "@/setups/voice-listener"
import { reloadSatelliteClientsForDomia } from "@/setups/satellite-clients"
import { normalizeRuntimeCapabilities } from "@/setups/environment"

const heartbeatHandles = new Map<string, ReturnType<typeof setInterval>>()

export const bootHostedIdentity = async (
	key: string,
): Promise<DomiaType | null> => {
	if (heartbeatHandles.has(key) || isHostedIdentity(key))
		await teardownHostedIdentity(key)
	let domia = await getDomia(key)
	if (!domia?.runtimeCapabilities) {
		appLogger.info(`🌱 seeding neutral hosted identity ${key}`)
		await initialize(
			{ ...DEFAULT_CONFIG_VALUES, domiaKey: key },
			{ isHosted: true },
		)
		domia = await getDomia(key)
	}
	if (!domia?.runtimeCapabilities) {
		appLogger.warn("hosted identity could not be seeded — skipping", { key })
		return null
	}
	const caps = normalizeRuntimeCapabilities(domia.runtimeCapabilities)
	setupCoreBus({ domia, runtimeCapabilities: caps })
	registerHostedIdentity(domia.domiaKey)
	await setupSkills(domia).catch((err) =>
		appLogger.error("Skill setup failed (skills disabled)", {
			err,
			domiaKey: key,
		}),
	)
	const handle = setupHeartbeat({ domia })
	if (typeof handle.unref === "function") handle.unref()
	heartbeatHandles.set(key, handle)
	warmupOnBoot(domia, caps)
	appLogger.info(`🧠 hosting identity ${domia.domiaKey}`)
	return domia
}

export const teardownHostedIdentity = async (key: string): Promise<void> => {
	const domia = await getDomia(key).catch(() => null)
	if (domia) abortActiveTurn(domia.id, "identity-teardown")
	const handle = heartbeatHandles.get(key)
	if (handle) clearInterval(handle)
	heartbeatHandles.delete(key)
	if (domia) teardownCoreBus(domia.id)
	await stopSkills(key)
	stopVoiceListener(key)
	unregisterHostedIdentity(key)
	if (domia) await reloadSatelliteClientsForDomia(domia)
	appLogger.info(`🪫 stopped hosting identity ${key}`)
}

export const bootHostedIdentities = async (): Promise<void> => {
	const roster = (await getHostedDomias()).filter(
		(domia): domia is DomiaType => !!domia,
	)
	for (const entry of roster) await bootHostedIdentity(entry.domiaKey)
}

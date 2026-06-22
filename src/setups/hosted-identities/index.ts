import type { MqttClient } from "mqtt"

import { appLogger } from "@/utils"
import {
	type DomiaType,
	getDomia,
	getHostedDomias,
	registerHostedIdentity,
} from "@/modules/core"
import { initialize, DEFAULT_CONFIG_VALUES } from "@/modules/config-engine"
import { warmupOnBoot } from "@/modules/warmup"
import { setupCoreBus } from "@/setups/core-bus"
import { setupSkills } from "@/setups/skills"
import { setupHeartbeat } from "@/setups/heartbeat"
import { normalizeRuntimeCapabilities } from "@/setups/environment"

export const bootHostedIdentities = async ({
	mqttClient,
}: {
	mqttClient: MqttClient | null
}): Promise<void> => {
	const roster = (await getHostedDomias()).filter(
		(domia): domia is DomiaType => !!domia,
	)
	for (const entry of roster) {
		const key = entry.domiaKey
		let domia: DomiaType | undefined = entry
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
			continue
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
		setupHeartbeat({ domia, mqttClient })
		warmupOnBoot(domia, caps)
		appLogger.info(`🧠 hosting identity ${domia.domiaKey}`)
	}
}

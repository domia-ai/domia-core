import { appLogger, CORE_ERRORS, getErrorMessage } from "@/utils"
import { initialize } from "./modules/config-engine"
import {
	setupVoiceListener,
	setupDomiaBus,
	setupMqtt,
	setupEnvironment,
	normalizeRuntimeCapabilities,
	setupHttpServer,
	setupHeartbeat,
} from "./setups"

process.on("uncaughtException", (err) => {
	appLogger.error("Uncaught Exception:", err)
})

process.on("unhandledRejection", (reason) => {
	appLogger.error("Unhandled Rejection:", reason)
})

async function main() {
	appLogger.info("Initialize Domia with default config")
	const ownDomia = await initialize()

	const domiaRuntimeCapabilities = ownDomia?.runtimeCapabilities
	if (!domiaRuntimeCapabilities) {
		appLogger.error(getErrorMessage(CORE_ERRORS.MISSING_CAPABILITIES))
		process.exit(1)
	}

	const runtimeCapabilities = normalizeRuntimeCapabilities(
		domiaRuntimeCapabilities,
	)
	setupEnvironment(runtimeCapabilities)

	const localMqttConfig = ownDomia?.localMqttConfig
	const remoteMqttConfig = ownDomia?.remoteMqttConfig

	const localMqttClient = setupMqtt({
		domia: ownDomia,
		config: localMqttConfig,
	})
	setupMqtt({ domia: ownDomia, config: remoteMqttConfig })
	setupDomiaBus({
		domia: ownDomia,
		runtimeCapabilities,
		mqttClient: localMqttClient,
	})
	setupHeartbeat({ domia: ownDomia, mqttClient: localMqttClient })
	setupHttpServer()

	if (runtimeCapabilities?.wakeword && runtimeCapabilities?.record) {
		await setupVoiceListener(ownDomia)
		appLogger.info(`🤖 Running voice listener: ${ownDomia.name}`)
	}

	appLogger.info(`DOMIA is running and waiting for events...`)
}

main()

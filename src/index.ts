import { env } from "@/config"
import { appLogger, CORE_ERRORS, getErrorMessage } from "@/utils"
import { initialize } from "./modules/config-engine"
import {
	setupVoiceListener,
	setupCoreBus,
	setupMqtt,
	setupEnvironment,
	normalizeRuntimeCapabilities,
	setupHttpServer,
	setupHeartbeat,
	setupGrpcServer,
} from "./setups"

process.on("uncaughtException", (err) => {
	appLogger.error("Uncaught Exception:", err)
	if (env.NODE_ENV === "production") {
		appLogger.error("Exiting on uncaughtException (supervisor will restart)")
		process.exit(1)
	}
})

process.on("unhandledRejection", (reason) => {
	appLogger.error("Unhandled Rejection:", reason)
})

async function main() {
	appLogger.info("Initialize Domia with default config")
	const ownDomia = await initialize()

	if (!ownDomia?.runtimeCapabilities) {
		appLogger.error(getErrorMessage(CORE_ERRORS.MISSING_CAPABILITIES))
		process.exit(1)
	}

	const runtimeCapabilities = normalizeRuntimeCapabilities(
		ownDomia.runtimeCapabilities,
	)
	const { missingBinaries } = setupEnvironment(runtimeCapabilities)

	const localMqttClient = setupMqtt({
		domia: ownDomia,
		config: ownDomia.localMqttConfig,
	})
	setupMqtt({ domia: ownDomia, config: ownDomia.remoteMqttConfig })
	setupCoreBus({
		domia: ownDomia,
		runtimeCapabilities,
		mqttClient: localMqttClient,
	})
	setupHeartbeat({ domia: ownDomia, mqttClient: localMqttClient })
	setupHttpServer({ domia: ownDomia, mqttClient: localMqttClient })

	await setupGrpcServer({ domia: ownDomia, capabilities: runtimeCapabilities })

	await setupVoiceListener(ownDomia, missingBinaries)

	appLogger.info(`DOMIA is running and waiting for events...`)
}

void main().catch((err) => {
	appLogger.error("Boot failed", { err })
	process.exit(1)
})

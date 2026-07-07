import { env } from "@/config"
import { appLogger, CORE_ERRORS, getErrorMessage } from "@/utils"
import { initialize } from "./modules/config-engine"
import { setGrpcClientTunables } from "./modules/grpc-client"
import { isHostedIdentity, getNodeId } from "./modules/core"
import { setLocalMqttClient } from "./modules/heartbeat-manager"
import { setupTempSweeper } from "./setups/temp-sweeper"
import { setupRetention } from "./setups/retention"
import { setupShutdown } from "./setups/shutdown"
import {
	setupTurnEventLogging,
	setupTurnEventPersistence,
} from "./setups/turn-events"
import {
	setupVoiceListener,
	setupMqtt,
	setupEnvironment,
	normalizeRuntimeCapabilities,
	setupHttpServer,
	setupGrpcServer,
	setupSatelliteClients,
	bootHostedIdentities,
	setupConfigReloaders,
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
	setupShutdown()
	setupTurnEventLogging()
	setupTurnEventPersistence()
	const ownDomia = await initialize(undefined, { isHosted: true })
	setGrpcClientTunables(ownDomia)
	setupTempSweeper()
	setupRetention()
	setupConfigReloaders()

	if (!ownDomia?.runtimeCapabilities) {
		appLogger.error(getErrorMessage(CORE_ERRORS.MISSING_CAPABILITIES))
		process.exit(1)
	}

	const runtimeCapabilities = normalizeRuntimeCapabilities(
		ownDomia.runtimeCapabilities,
	)
	const { missingBinaries } = setupEnvironment(runtimeCapabilities)

	const nodeId = await getNodeId()
	const localMqttClient = setupMqtt({
		domia: ownDomia,
		config: ownDomia.localMqttConfig,
		nodeId,
	})
	setLocalMqttClient(localMqttClient)

	await bootHostedIdentities()

	setupHttpServer({ domia: ownDomia })
	await setupGrpcServer({ domia: ownDomia, capabilities: runtimeCapabilities })
	await setupSatelliteClients({ fallback: ownDomia })

	if (isHostedIdentity(ownDomia.domiaKey)) {
		await setupVoiceListener(ownDomia, missingBinaries)
	} else {
		appLogger.info(
			`🎙️ local voice listener skipped — ${ownDomia.domiaKey} is not in the hosted set`,
		)
	}

	appLogger.info(`DOMIA is running and waiting for events...`)
}

void main().catch((err) => {
	appLogger.error("Boot failed", { err })
	process.exit(1)
})

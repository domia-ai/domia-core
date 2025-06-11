import "dotenv/config"

import { appLogger, CORE_ERRORS, getErrorMessage } from "@/utils"
import { initialize } from "./modules/config-engine"
import { getActiveDomias } from "./modules/core"
import {
	setupOwnDomia,
	setupDomiaBus,
	setupLocalMqtt,
	setupRemoteMqtt,
	setupEnvironment,
} from "./setups"
import { env } from "@/config"

process.on("uncaughtException", (err) => {
	appLogger.error("Uncaught Exception:", err)
})

process.on("unhandledRejection", (reason) => {
	appLogger.error("Unhandled Rejection:", reason)
})

async function main() {
	setupEnvironment()

	appLogger.info("Initialize Domia with default config")
	await initialize()

	const domias = await getActiveDomias()

	if (!domias || !domias.length) {
		appLogger.error(getErrorMessage(CORE_ERRORS.DOMIAS_NOT_FOUND))
		process.exit(1)
	}

	appLogger.info(`🧠 Found ${domias.length} active Domia(s)`)
	const ownDomia = domias?.find((domia) => domia?.domiaKey === env.DOMIA_KEY)

	if (ownDomia) {
		await setupOwnDomia(ownDomia)
		appLogger.info(`🤖 Running local Domia: ${ownDomia.name}`)
	}

	setupDomiaBus(domias)
	setupLocalMqtt(domias)
	setupRemoteMqtt(domias)

	await new Promise(() => {
		appLogger.info(`DOMIA is running and waiting for events...`)
	})
}

main()

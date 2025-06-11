import "dotenv/config"
import { setupEnvironment } from "@/setups"
import { appLogger, getErrorMessage, CORE_ERRORS } from "@/utils"

async function main() {
	appLogger.info("🔍 Checking environment for DOMIA...")

	try {
		setupEnvironment()
		appLogger.info("✅ Everything is ready to go!")
	} catch (err) {
		appLogger.error("❌ Environment check failed.", { err })
		appLogger.error(getErrorMessage(CORE_ERRORS.WRONG_ENVIRONMENT))
		process.exit(1)
	}
}

main()

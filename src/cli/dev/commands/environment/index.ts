import { setupEnvironment } from "@/setups"
import { devCliLogger, getErrorMessage, CORE_ERRORS } from "@/utils"

export const environmentCommand = () => {
	try {
		devCliLogger.info("🔍 Checking environment for Domia...")
		setupEnvironment()
		devCliLogger.info("✅ Everything is ready to go!")
	} catch (err) {
		devCliLogger.error("❌ Environment check failed.", { err })
		devCliLogger.error(getErrorMessage(CORE_ERRORS.WRONG_ENVIRONMENT))
	}
}

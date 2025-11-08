import { execSync } from "child_process"
import { mkdirSync, existsSync } from "fs"
import { join } from "path"
import { appLogger, CORE_ERRORS, domiaError } from "@/utils"
import { PYTHON_BIN } from "@/config"
import type { CapabilityKeyType, PartialRuntimeCapabilitiesType } from "./types"
import { RUNTIME_CAPABILITIES, CAPABILITY_RESOURCES } from "./contants"

export const setupEnvironment = (
	runtimeCapabilities: PartialRuntimeCapabilitiesType = RUNTIME_CAPABILITIES,
) => {
	appLogger.info("🌱 Setting up environment...")
	const binariesToCheck: { name: string; command: string }[] = []
	const pythonModulesToCheck: string[] = []
	const tempDirsToEnsure = new Set<string>()

	for (const capability of Object.keys(
		runtimeCapabilities,
	) as CapabilityKeyType[]) {
		if (!runtimeCapabilities?.[capability]) continue

		const resources = CAPABILITY_RESOURCES?.[capability]
		if (!resources) continue

		resources?.binaries?.forEach((bin) => binariesToCheck.push(bin))
		resources?.pythonModules?.forEach((mod) => pythonModulesToCheck.push(mod))
		resources?.tempDirs?.forEach((dir) => tempDirsToEnsure.add(dir))
	}

	const missingBinaries: string[] = []
	const missingModules: string[] = []

	for (const bin of binariesToCheck) {
		try {
			execSync(bin.command, { stdio: "ignore" })
			appLogger.info(`✅ Binary found: ${bin.name}`)
		} catch {
			missingBinaries.push(bin.name)
			appLogger.error(`❌ Missing required binary: ${bin.name}`)
		}
	}

	if (missingBinaries?.length > 0) {
		throw domiaError(CORE_ERRORS.WRONG_ENVIRONMENT, {
			meta: { missingBinaries },
		})
	}

	for (const dir of tempDirsToEnsure) {
		const absPath = join(process.cwd(), dir)
		mkdirSync(absPath, { recursive: true })
		appLogger.info(`📁 Ensured folder: ${dir}`)
	}

	if (!existsSync(PYTHON_BIN)) {
		throw domiaError(CORE_ERRORS.WRONG_ENVIRONMENT, {
			meta: { python: "Virtual environment not found at .venv/" },
		})
	}

	for (const mod of pythonModulesToCheck) {
		try {
			execSync(`${PYTHON_BIN} -c "import ${mod}"`, { stdio: "ignore" })
			appLogger.info(`🐍 Python module found: ${mod}`)
		} catch {
			missingModules.push(mod)
			appLogger.error(`❌ Missing required Python module: ${mod}`)
		}
	}

	if (missingModules.length > 0) {
		throw domiaError(CORE_ERRORS.WRONG_ENVIRONMENT, {
			meta: { missingPythonModules: missingModules },
		})
	}

	appLogger.info("✅ Environment ready")
}

import { execSync } from "child_process"
import { mkdirSync, existsSync } from "fs"
import { join } from "path"
import { appLogger, CORE_ERRORS, domiaError } from "@/utils"
import { PYTHON_BIN } from "@/config"

const BINARIES = [{ name: "sox", command: "sox --version", required: true }]
const TMP_DIRS = ["tmp", "tmp/recordings", "tmp/tts-output"]
const PYTHON_MODULES = [
	"sounddevice", // 🎙️ mic access for OpenWakeWord
	"numpy", // 📐 used by OpenWakeWord internally
	"openwakeword", // 🧠 wake word engine
	"vosk", // 🗣️ speech-to-text engine
	"piper", // 🔊 text-to-speech engine
	"soundfile", // 💾 audio file output for TTS (used by Piper)
]

export const setupEnvironment = () => {
	appLogger.info("🌱 Setting up environment...")

	const missingRequired: string[] = []

	for (const bin of BINARIES) {
		try {
			execSync(bin.command, { stdio: "ignore" })
			appLogger.info(`✅ Binary found: ${bin.name}`)
		} catch {
			if (bin.required) {
				missingRequired.push(bin.name)
				appLogger.error(`❌ Missing required binary: ${bin.name}`)
			} else {
				appLogger.warn(`⚠️ Optional binary not found: ${bin.name}`)
			}
		}
	}

	if (missingRequired.length > 0) {
		throw domiaError(CORE_ERRORS.WRONG_ENVIRONMENT, {
			meta: {
				missingRequired,
			},
		})
	}

	for (const relPath of TMP_DIRS) {
		const absPath = join(process.cwd(), relPath)
		mkdirSync(absPath, { recursive: true })
		appLogger.info(`📁 Ensured folder: ${relPath}`)
	}

	if (!existsSync(PYTHON_BIN)) {
		throw domiaError(CORE_ERRORS.WRONG_ENVIRONMENT, {
			meta: { python: "Virtual environment not found at .venv/" },
		})
	}

	const missingModules: string[] = []

	for (const module of PYTHON_MODULES) {
		try {
			execSync(`${PYTHON_BIN} -c "import ${module}"`, { stdio: "ignore" })
			appLogger.info(`🐍 Python module found: ${module}`)
		} catch {
			missingModules.push(module)
			appLogger.error(`❌ Missing required Python module: ${module}`)
		}
	}

	if (missingModules.length > 0) {
		throw domiaError(CORE_ERRORS.WRONG_ENVIRONMENT, {
			meta: {
				python: missingModules,
			},
		})
	}

	appLogger.info("✅ Environment ready")
}

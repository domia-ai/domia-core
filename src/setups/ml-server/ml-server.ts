import { spawn, type ChildProcess } from "child_process"
import path from "path"

import { env, PYTHON_BIN } from "@/config"
import { type DomiaType } from "@/modules/core"
import { pingMlServer } from "@/modules/ml-client"
import { mlServerLogger, ML_ERRORS, domiaError } from "@/utils"

const MAX_RESTARTS_PER_WINDOW = 3
const RESTART_WINDOW_MS = 60_000
const HEALTH_POLL_INTERVAL_MS = 500

let child: ChildProcess | null = null
let restartTimestamps: number[] = []

const pythonResourcesDir = path.resolve("src/resources/python")

const getEnginesToWarm = (domia: DomiaType): string[] => {
	const warm: string[] = []
	if (domia.runtimeCapabilities?.tts && domia.ttsConfig?.engine) {
		warm.push(domia.ttsConfig.engine)
	}
	if (domia.runtimeCapabilities?.stt && domia.sttConfig?.engine) {
		warm.push(domia.sttConfig.engine)
	}
	return warm
}

const waitForReady = async (timeoutMs: number): Promise<void> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await pingMlServer()) return
		await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
	}
	throw domiaError(ML_ERRORS.SERVER_START_FAILED, {
		logger: mlServerLogger,
		meta: { timeoutMs },
	})
}

const spawnProcess = (warm: string[]): ChildProcess => {
	const args = [
		"-m",
		"domia_ml_server",
		"--host",
		env.DOMIA_ML_HOST,
		"--port",
		env.DOMIA_ML_PORT,
	]
	if (warm.length > 0) {
		args.push("--warm", warm.join(","))
	}
	const proc = spawn(PYTHON_BIN, args, {
		env: { ...process.env, PYTHONPATH: pythonResourcesDir },
		stdio: ["ignore", "pipe", "pipe"],
	})
	proc.stdout?.on("data", (data) => {
		mlServerLogger.info(`[stdout] ${data.toString().trim()}`)
	})
	proc.stderr?.on("data", (data) => {
		mlServerLogger.info(`[stderr] ${data.toString().trim()}`)
	})
	return proc
}

const handleExit = (warm: string[]) => (code: number | null) => {
	mlServerLogger.warn(`ml-server exited (code ${code})`)
	const now = Date.now()
	restartTimestamps = restartTimestamps.filter(
		(ts) => now - ts < RESTART_WINDOW_MS,
	)
	if (restartTimestamps.length >= MAX_RESTARTS_PER_WINDOW) {
		mlServerLogger.error(
			`ml-server crashed ${MAX_RESTARTS_PER_WINDOW} times in last ${RESTART_WINDOW_MS}ms — giving up`,
		)
		child = null
		return
	}
	restartTimestamps.push(now)
	mlServerLogger.info(
		`restarting ml-server (attempt ${restartTimestamps.length}/${MAX_RESTARTS_PER_WINDOW})`,
	)
	child = spawnProcess(warm)
	child.on("exit", handleExit(warm))
}

const shouldStart = (domia: DomiaType): boolean => {
	if (env.DOMIA_ML_SERVER_DISABLED) {
		mlServerLogger.info("DOMIA_ML_SERVER_DISABLED set — skipping ml-server")
		return false
	}
	const caps = domia.runtimeCapabilities
	const needsMl = Boolean(caps?.tts) || Boolean(caps?.stt)
	if (!needsMl) {
		mlServerLogger.info("node has no TTS/STT capabilities — skipping ml-server")
	}
	return needsMl
}

export const setupMlServer = async ({ domia }: { domia: DomiaType }) => {
	if (!shouldStart(domia)) return

	if (await pingMlServer()) {
		mlServerLogger.info(
			`ml-server already running on ${env.DOMIA_ML_HOST}:${env.DOMIA_ML_PORT} — reusing`,
		)
		return
	}

	const warm = getEnginesToWarm(domia)
	mlServerLogger.info(
		`🚀 starting ml-server on port ${env.DOMIA_ML_PORT} (warm: ${warm.join(", ") || "none"})`,
	)

	child = spawnProcess(warm)
	child.on("exit", handleExit(warm))

	const timeoutMs = Number(env.DOMIA_ML_READY_TIMEOUT_MS)
	try {
		await waitForReady(timeoutMs)
		mlServerLogger.success(`✅ ml-server ready on port ${env.DOMIA_ML_PORT}`)
	} catch (err) {
		mlServerLogger.error(`❌ ml-server failed to become ready: ${err}`)
		child?.kill()
		child = null
		throw err
	}

	const cleanup = () => {
		if (child) {
			mlServerLogger.info("shutting down ml-server")
			child.removeAllListeners("exit")
			child.kill()
			child = null
		}
	}
	process.once("SIGINT", cleanup)
	process.once("SIGTERM", cleanup)
	process.once("exit", cleanup)
}

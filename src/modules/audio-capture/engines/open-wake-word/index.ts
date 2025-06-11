import { spawn } from "child_process"
import path from "path"

import { type DomiaType } from "@/modules/core"
import { audioCaptureLogger, domiaError, AUDIO_ERRORS } from "@/utils"
import { WAKE_WORD_FRAMEWORK_ENUM } from "@/db"
import { PYTHON_BIN } from "@/config"

import { type CaptureCallbacksType } from "../../types"

export const runOpenWakeWord = async (
	domia: DomiaType,
	callbacks?: CaptureCallbacksType,
) => {
	const wakeWordConfig = domia.wakeWordConfig

	if (!wakeWordConfig) {
		const err = domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
		})
		callbacks?.onError?.(err)
		throw err
	}

	const scriptPath = path.resolve(
		"src/resources/python/open-wake-word/runner.py",
	)
	const sensitivity = wakeWordConfig?.sensitivity ?? 0.5
	const threshold = wakeWordConfig?.threshold ?? 0.5
	const cooldown = wakeWordConfig?.cooldown ?? 0.5
	const model = wakeWordConfig?.model
	const framework = wakeWordConfig?.framework ?? WAKE_WORD_FRAMEWORK_ENUM.ONNX
	const device = wakeWordConfig?.inputDeviceIndex ?? 0
	const args = [
		scriptPath,
		"--model",
		model,
		"--sensitivity",
		sensitivity.toString(),
		"--framework",
		framework,
		"--threshold",
		threshold.toString(),
		"--cooldown",
		cooldown.toString(),
		"--device",
		device.toString(),
	]

	const pythonProcess = spawn(PYTHON_BIN, args)

	pythonProcess.stdout.on("data", (data) => {
		const message = data.toString().trim()
		audioCaptureLogger.info(`[wakeword:stdout] ${message}`)

		if (message === "wakeword_detected") {
			callbacks?.onWake?.()
		} else if (message.startsWith("[error]")) {
			const err = new Error(message.replace("[error]", "").trim())
			callbacks?.onError?.(err)
		}
	})

	pythonProcess.stderr.on("data", (data) => {
		const errorMsg = data.toString()
		audioCaptureLogger.error(`[wakeword:stderr] ${errorMsg}`)
		callbacks?.onError?.(new Error(errorMsg))
	})

	pythonProcess.on("close", (code) => {
		audioCaptureLogger.info(`[wakeword] process terminated with code ${code}`)
	})
}

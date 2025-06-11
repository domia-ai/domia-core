import { spawn } from "child_process"
import path from "path"

import { type DomiaType } from "@/modules/core"
import { STT_ERRORS, sttEngineLogger, domiaError } from "@/utils"
import { PYTHON_BIN } from "@/config"

export const spawnPython = (
	args: string[],
): Promise<Record<string, string>> => {
	return new Promise((resolve, reject) => {
		const process = spawn(PYTHON_BIN, args)
		let data = ""

		process.stdout.on("data", (chunk) => {
			data += chunk?.toString()
		})

		process.stderr.on("data", (err) => {
			const errorMsg = err.toString()
			sttEngineLogger.error(`[vosk:stderr] ${errorMsg}`)
		})

		process.on("close", () => {
			try {
				const json = JSON.parse(data)
				resolve(json)
			} catch (err) {
				sttEngineLogger.error(`[vosk:close] ${err}`)
				reject(new Error("Invalid JSON output from Python script"))
			}
		})
	})
}

export const runVosk = async (domia: DomiaType, filePath: string) => {
	const sttConfig = domia?.sttConfig

	if (!sttConfig) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
		})
	}

	const modelName = sttConfig?.modelName
	const modelPath = sttConfig?.modelPath
	const timeoutMs = sttConfig?.timeoutMs ?? 5000
	const scriptPath = path.resolve("src/resources/python/vosk/runner.py")
	const resolvedModelPath = modelPath
		? path.resolve(modelPath)
		: path.resolve("src/resources/stt-models/vosk", modelName)
	sttEngineLogger.info(`🔍 Using model: ${resolvedModelPath}`)
	const args = [
		scriptPath,
		"--file",
		filePath,
		"--model",
		resolvedModelPath,
		"--timeout",
		timeoutMs.toString(),
	]

	const result = await spawnPython(args)

	if (result.error) {
		throw domiaError(STT_ERRORS.TRANSCRIPTION_FAILED, {
			meta: {
				error: result.error,
			},
		})
	}

	return result.transcript || ""
}

import path from "path"

import { type DomiaType } from "@/modules/core"
import { STT_ERRORS, sttEngineLogger, domiaError } from "@/utils"
import { spawnPython } from "../vosk"

export const runWhisper = async (domia: DomiaType, filePath: string) => {
	const sttConfig = domia?.sttConfig

	if (!sttConfig) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
		})
	}

	const modelName = sttConfig?.modelName
	const modelPath = sttConfig?.modelPath
	const timeoutMs = sttConfig?.timeoutMs ?? 10000
	const scriptPath = path.resolve("src/resources/python/whisper/runner.py")
	const resolvedModelPath = modelPath
		? path.resolve(modelPath)
		: path.resolve(
				"src/resources/stt-models/whisper",
				modelName,
				"ggml-model.bin",
			)
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
			meta: { error: result.error },
		})
	}

	return result.transcript || ""
}

import path from "path"

import { type DomiaType } from "@/modules/core"
import { transcribeStt } from "@/modules/ml-client"
import { STT_ERRORS, sttEngineLogger, domiaError } from "@/utils"
import { STT_ENGINE_ENUM } from "@/db"
import { env } from "@/config"
import { spawnPython } from "../vosk"

const transcribeViaMlServer = async (
	modelName: string,
	filePath: string,
): Promise<string> => {
	const result = await transcribeStt({
		engine: STT_ENGINE_ENUM.WHISPER,
		filePath,
		modelName,
	})
	return result.transcript
}

const transcribeViaSpawn = async (
	modelName: string,
	modelPath: string | null,
	filePath: string,
	timeoutMs: number,
): Promise<string> => {
	const scriptPath = path.resolve("src/resources/python/whisper/runner.py")
	const resolvedModelPath = modelPath
		? path.resolve(modelPath)
		: path.resolve(
				"src/resources/stt-models/whisper",
				modelName,
				"ggml-model.bin",
			)

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

	return env.DOMIA_ML_SERVER_DISABLED
		? await transcribeViaSpawn(modelName, modelPath, filePath, timeoutMs)
		: await transcribeViaMlServer(modelName, filePath)
}

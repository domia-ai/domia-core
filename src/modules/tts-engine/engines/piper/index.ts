import { readFile } from "fs/promises"
import path from "path"
import { spawn } from "child_process"

import { DomiaType } from "@/modules/core"
import { generateUuid, ttsEngineLogger } from "@/utils"
import { TTS_ERRORS, domiaError } from "@/utils"
import { type RunTtsResultType } from "../../types"
import { PYTHON_BIN } from "@/config"

export const runPiper = async (
	domia: DomiaType,
	text: string,
): Promise<RunTtsResultType> => {
	const ttsConfig = domia.ttsConfig
	const voiceName = ttsConfig?.voiceName

	if (!voiceName) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				domiaId: domia.id,
				voiceName,
			},
		})
	}

	const voiceDir = path.resolve("src/resources/tts-models/piper", voiceName)
	const modelPath = path.join(voiceDir, `voice.onnx`)
	const configPath = path.join(voiceDir, `config.json`)
	const scriptPath = path.resolve("src/resources/python/piper/runner.py")
	const filePath = path.resolve("tmp/tts-output", `domia-${generateUuid()}.wav`)

	const args = [
		scriptPath,
		"--text",
		text,
		"--model_path",
		modelPath,
		"--config_path",
		configPath,
		"--output_path",
		filePath,
	]

	await new Promise<void>((resolve, reject) => {
		const process = spawn(PYTHON_BIN, args)

		process.on("error", reject)

		process.stderr.on("data", (data) => {
			console.error(`❌ Piper Python error: ${data}`)
		})

		process.on("close", (code) => {
			if (code !== 0) {
				return reject(new Error(`run_piper.py exited with code ${code}`))
			}
			resolve()
		})
	})

	const buffer = await readFile(filePath)

	return {
		engineUsed: "PIPER",
		voiceUsed: voiceName,
		format: "wav",
		filePath,
		buffer,
		metadata: { text },
	}
}

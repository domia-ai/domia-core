import { readFile } from "fs/promises"
import path from "path"
import { spawn } from "child_process"

import { DomiaType } from "@/modules/core"
import { generateUuid, ttsEngineLogger } from "@/utils"
import { TTS_ERRORS, domiaError } from "@/utils"
import { type RunTtsResultType } from "../../types"
import { PYTHON_BIN } from "@/config"

export const runKokoro = async (
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

	const scriptPath = path.resolve("src/resources/python/kokoro/runner.py")
	const filePath = path.resolve("tmp/tts-output", `domia-${generateUuid()}.wav`)

	const args = [
		scriptPath,
		"--text",
		text,
		"--voice",
		voiceName,
		"--output_path",
		filePath,
	]

	await new Promise<void>((resolve, reject) => {
		const process = spawn(PYTHON_BIN, args)

		process.on("error", reject)

		process.stderr.on("data", (data) => {
			ttsEngineLogger.error(`Kokoro Python error: ${data}`, {
				domiaId: domia.id,
				voiceName,
			})
		})

		process.on("close", (code) => {
			if (code !== 0) {
				return reject(new Error(`kokoro runner.py exited with code ${code}`))
			}
			resolve()
		})
	})

	const buffer = await readFile(filePath)

	return {
		engineUsed: "KOKORO",
		voiceUsed: voiceName,
		format: "wav",
		filePath,
		buffer,
		metadata: { text, lang: "en-US" },
	}
}

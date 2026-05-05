import { writeFile, mkdir, readFile } from "fs/promises"
import path from "path"
import { spawn } from "child_process"

import { DomiaType } from "@/modules/core"
import { synthesizeTts } from "@/modules/ml-client"
import { generateUuid, ttsEngineLogger, TTS_ERRORS, domiaError } from "@/utils"
import { TTS_ENGINE_ENUM } from "@/db"
import { env, PYTHON_BIN } from "@/config"
import { type RunTtsResultType } from "../../types"

const synthesizeViaMlServer = async (
	voiceName: string,
	text: string,
	filePath: string,
): Promise<Buffer> => {
	const result = await synthesizeTts({
		engine: TTS_ENGINE_ENUM.KOKORO,
		text,
		voice: voiceName,
	})
	await writeFile(filePath, result.audio)
	return result.audio
}

const synthesizeViaSpawn = async (
	domiaId: string,
	voiceName: string,
	text: string,
	filePath: string,
): Promise<Buffer> => {
	const scriptPath = path.resolve("src/resources/python/kokoro/runner.py")
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
		const proc = spawn(PYTHON_BIN, args)
		proc.on("error", reject)
		proc.stderr.on("data", (data) => {
			ttsEngineLogger.error(`Kokoro Python error: ${data}`, {
				domiaId,
				voiceName,
			})
		})
		proc.on("close", (code) => {
			if (code !== 0) {
				return reject(new Error(`kokoro runner.py exited with code ${code}`))
			}
			resolve()
		})
	})

	return await readFile(filePath)
}

export const runKokoro = async (
	domia: DomiaType,
	text: string,
): Promise<RunTtsResultType> => {
	const ttsConfig = domia.ttsConfig
	const voiceName = ttsConfig?.voiceName

	if (!voiceName) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { domiaId: domia.id, voiceName },
		})
	}

	const outputDir = path.resolve("tmp/tts-output")
	await mkdir(outputDir, { recursive: true })
	const filePath = path.join(outputDir, `domia-${generateUuid()}.wav`)

	const buffer = env.DOMIA_ML_SERVER_DISABLED
		? await synthesizeViaSpawn(domia.id, voiceName, text, filePath)
		: await synthesizeViaMlServer(voiceName, text, filePath)

	return {
		engineUsed: "KOKORO",
		voiceUsed: voiceName,
		format: "wav",
		filePath,
		buffer,
		metadata: { text, lang: "en-US" },
	}
}

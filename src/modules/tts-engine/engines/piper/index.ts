import { writeFile, mkdir } from "fs/promises"
import path from "path"

import { DomiaType } from "@/modules/core"
import { synthesizeTts } from "@/modules/ml-client"
import { generateUuid, ttsEngineLogger, TTS_ERRORS, domiaError } from "@/utils"
import { TTS_ENGINE_ENUM } from "@/db"
import { type RunTtsResultType } from "../../types"

export const runPiper = async (
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

	const result = await synthesizeTts({
		engine: TTS_ENGINE_ENUM.PIPER,
		text,
		voice: voiceName,
	})
	await writeFile(filePath, result.audio)

	return {
		engineUsed: "PIPER",
		voiceUsed: voiceName,
		format: "wav",
		filePath,
		buffer: result.audio,
		metadata: { text },
	}
}

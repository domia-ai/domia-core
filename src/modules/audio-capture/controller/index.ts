import { spawn } from "child_process"
import { mkdirSync } from "fs"
import { join } from "path"
import { once } from "events"

import { type DomiaType } from "@/modules/core"
import { WAKE_WORD_ENGINE_ENUM_VALUES } from "@/db"
import {
	AUDIO_ERRORS,
	audioCaptureLogger,
	domiaError,
	generateUuid,
} from "@/utils"
import { wakeWordEngines } from "../engines"
import { type CaptureCallbacksType } from "../types"
import { RECORDINGS_DIR } from "../constants"

export const startCapture = async (
	domia: DomiaType,
	callbacks?: CaptureCallbacksType,
) => {
	const wakeWordConfig = domia?.wakeWordConfig
	const engine = wakeWordConfig?.engine

	if (!engine || !WAKE_WORD_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_ENGINE_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: {
				engine,
			},
		})
	}

	const handler = wakeWordEngines[engine]

	await handler(domia, callbacks)
}

export const startAudioRecording = async (domia: DomiaType) => {
	mkdirSync(RECORDINGS_DIR, { recursive: true })

	const filename = `${domia?.id}_${generateUuid()}.wav`
	const outputPath = join(RECORDINGS_DIR, filename)

	const args = [
		"-d",
		"-r",
		"16000",
		"-c",
		"1",
		"-b",
		"16",
		outputPath,
		"silence",
		"1",
		"0.1",
		"1%",
		"1",
		"1.0",
		"1%",
	]

	audioCaptureLogger.info(`[🎙️] Starting recording to: ${outputPath}`)
	const sox = spawn("sox", args)

	sox.stderr.on("data", (data) => {
		audioCaptureLogger.warn(`[sox stderr]: ${data}`)
	})

	sox.on("close", (code) => {
		audioCaptureLogger.info(`[🎙️] Recording finished with code ${code}`)
	})

	await once(sox, "close")

	return outputPath
}

import { once } from "events"

import { type DomiaType } from "@/modules/core"
import { WAKE_WORD_ENGINE_ENUM_VALUES } from "@/db"
import { AUDIO_ERRORS, audioCaptureLogger, domiaError } from "@/utils"
import { wakeWordEngines } from "../engines"
import {
	type CaptureCallbacksType,
	type StartAudioStreamResultType,
} from "../types"
import {
	attachSoxStderrFilter,
	createStopSox,
	createVadWindow,
	ensureRecordingPath,
	spawnSoxCapture,
	writePcmAsWav,
} from "../utils"

export const startCapture = async (
	domia: DomiaType,
	callbacks?: CaptureCallbacksType,
): Promise<void> => {
	const engine = domia?.wakeWordConfig?.engine
	if (!engine || !WAKE_WORD_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_ENGINE_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: { engine },
		})
	}
	await wakeWordEngines[engine](domia, callbacks)
}

export const startAudioRecording = async (
	domia: DomiaType,
): Promise<string> => {
	const config = domia.wakeWordConfig
	if (!config) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: { message: "Recording requires wakeWordConfig" },
		})
	}
	const outputPath = ensureRecordingPath(domia.id)
	const sox = spawnSoxCapture(config)
	const vad = createVadWindow(config.vadModelPath)
	const stopSox = createStopSox(sox, "recording")
	const captured: Buffer[] = []
	const startedAt = Date.now()

	attachSoxStderrFilter(sox)
	audioCaptureLogger.info(`[🎙️] Starting VAD-gated recording to: ${outputPath}`)

	sox.stdout.on("data", (data: Buffer) => {
		captured.push(data)
		vad.feed(data)
		if (vad.completed()) return stopSox("vad detected end of speech")
		if (Date.now() - startedAt > config.maxRecordingMs) {
			stopSox("max recording duration reached")
		}
	})

	sox.on("close", (code) => {
		audioCaptureLogger.info(`[🎙️] Recording finished with code ${code ?? 0}`)
	})

	await once(sox, "close")
	await writePcmAsWav(outputPath, Buffer.concat(captured), config)
	return outputPath
}

export const startAudioStream = (
	domia: DomiaType,
): StartAudioStreamResultType => {
	const config = domia.wakeWordConfig
	if (!config) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: { message: "Streaming capture requires wakeWordConfig" },
		})
	}
	const outputPath = ensureRecordingPath(domia.id)
	const sox = spawnSoxCapture(config)
	const vad = createVadWindow(config.vadModelPath)
	const stopSox = createStopSox(sox, "streaming capture")
	const captured: Buffer[] = []
	const startedAt = Date.now()

	attachSoxStderrFilter(sox)
	audioCaptureLogger.info(
		`[🎙️] Starting streaming capture (file: ${outputPath})`,
	)

	const closePromise = new Promise<void>((resolve) => {
		sox.on("close", () => resolve())
	})

	const chunks = (async function* () {
		for await (const data of sox.stdout) {
			const buf = data as Buffer
			captured.push(buf)
			vad.feed(buf)
			if (vad.completed()) stopSox("vad detected end of speech")
			else if (Date.now() - startedAt > config.maxRecordingMs) {
				stopSox("max recording duration reached")
			}
			yield buf
		}
	})()

	const filePathPromise = closePromise.then(async () => {
		await writePcmAsWav(outputPath, Buffer.concat(captured), config)
		return outputPath
	})

	return {
		chunks,
		filePathPromise,
		stop: () => stopSox("external stop"),
	}
}

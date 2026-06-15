import { once } from "events"

import { type DomiaType } from "@/modules/core"
import { WAKE_WORD_ENGINE_ENUM_VALUES } from "@/db"
import { AUDIO_ERRORS, audioCaptureLogger, domiaError } from "@/utils"
import { wakeWordEngines } from "../engines"
import {
	type CaptureCallbacksType,
	type StartAudioStreamResultType,
	type SpeculativeCaptureHooksType,
	type SpeculativeCaptureResultType,
	type FollowUpRecordingResultType,
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
	const vad = createVadWindow(config)
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

export const startFollowUpRecording = async (
	domia: DomiaType,
): Promise<FollowUpRecordingResultType | null> => {
	const config = domia.wakeWordConfig
	if (!config) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: { message: "Follow-up recording requires wakeWordConfig" },
		})
	}
	const outputPath = ensureRecordingPath(domia.id)
	const sox = spawnSoxCapture(config)
	const vad = createVadWindow(config)
	const stopSox = createStopSox(sox, "follow-up recording")
	const captured: Buffer[] = []
	const startedAt = Date.now()
	const bytesPerMs =
		(config.sampleRate * (config.bitsPerSample / 8) * config.channels) / 1000
	const debounceMs = config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs
	let bytesSeen = 0
	let speechStartByte: number | null = null
	let speechEndAt: number | null = null

	attachSoxStderrFilter(sox)
	audioCaptureLogger.info(
		`[🎙️] Follow-up window open (${config.followUpWindowMs}ms, no wake word needed)`,
	)

	sox.stdout.on("data", (data: Buffer) => {
		captured.push(data)
		bytesSeen += data.length
		vad.feed(data)
		if (speechStartByte === null) {
			if (vad.speechActive()) {
				speechStartByte = Math.max(
					0,
					bytesSeen - data.length - config.followUpLeadPadMs * bytesPerMs,
				)
				audioCaptureLogger.info(`[🎙️] Follow-up speech detected, recording`)
				return
			}
			if (Date.now() - startedAt > config.followUpWindowMs) {
				stopSox("follow-up window expired with no speech")
			}
			return
		}
		if (vad.completed()) {
			speechEndAt = Date.now() - debounceMs
			return stopSox("vad detected end of speech")
		}
		if (
			Date.now() - startedAt >
			config.followUpWindowMs + config.maxRecordingMs
		) {
			stopSox("max recording duration reached")
		}
	})

	const watchdog = setTimeout(
		() => stopSox("watchdog timeout"),
		config.followUpWindowMs + config.maxRecordingMs,
	)
	await once(sox, "close")
	clearTimeout(watchdog)
	if (speechStartByte === null) {
		audioCaptureLogger.info(`[🎙️] Follow-up window closed, back to wake word`)
		return null
	}
	const pcm = Buffer.concat(captured).subarray(Math.floor(speechStartByte))
	await writePcmAsWav(outputPath, pcm, config)
	return { filePath: outputPath, speechEndAt }
}

export const startSpeculativeCapture = (
	domia: DomiaType,
	hooks: SpeculativeCaptureHooksType,
): SpeculativeCaptureResultType => {
	const config = domia.wakeWordConfig
	if (!config) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: { message: "Speculative capture requires wakeWordConfig" },
		})
	}
	const outputPath = ensureRecordingPath(domia.id)
	const sox = spawnSoxCapture(config)
	const vad = createVadWindow(config)
	const fastVad = createVadWindow(config, {
		minSilenceS: config.speculativeSilenceMs / 1000,
	})
	const stopSox = createStopSox(sox, "speculative capture")
	const captured: Buffer[] = []
	const startedAt = Date.now()
	const debounceMs = config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs
	let speculated = false
	let speechEndAt: number | null = null

	attachSoxStderrFilter(sox)
	audioCaptureLogger.info(
		`[🎙️] Speculative capture started (commit at ${config.speculativeSilenceMs}ms raw silence)`,
	)

	sox.stdout.on("data", (data: Buffer) => {
		captured.push(data)
		vad.feed(data)
		fastVad.feed(data)
		hooks.onChunk?.(data)
		if (speculated && fastVad.speechActive()) {
			speculated = false
			hooks.onResume(Buffer.concat(captured))
		} else if (
			!speculated &&
			fastVad.everDetected() &&
			!fastVad.speechActive()
		) {
			speculated = true
			hooks.onSpeculate(Buffer.concat(captured))
		}
		if (vad.completed()) {
			speechEndAt = Date.now() - debounceMs
			return stopSox("vad detected end of speech")
		}
		if (Date.now() - startedAt > config.maxRecordingMs) {
			stopSox("max recording duration reached")
		}
	})

	const watchdog = setTimeout(
		() => stopSox("watchdog timeout"),
		config.maxRecordingMs +
			config.vadMinSilenceS * 1000 +
			config.vadEndOfSpeechMs,
	)
	const closePromise = new Promise<void>((resolve) => {
		sox.on("close", () => {
			clearTimeout(watchdog)
			resolve()
		})
	})
	const finalPcmPromise = closePromise.then(() => Buffer.concat(captured))
	const filePathPromise = finalPcmPromise.then(async (pcm) => {
		await writePcmAsWav(outputPath, pcm, config)
		return outputPath
	})

	return {
		finalPcmPromise,
		filePathPromise,
		speechEndAt: () => speechEndAt,
		stop: () => stopSox("external stop"),
	}
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
	const vad = createVadWindow(config)
	const stopSox = createStopSox(sox, "streaming capture")
	const captured: Buffer[] = []
	const startedAt = Date.now()
	const debounceMs = config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs
	let speechEndAt: number | null = null

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
			if (vad.completed()) {
				if (speechEndAt === null) speechEndAt = Date.now() - debounceMs
				stopSox("vad detected end of speech")
			} else if (Date.now() - startedAt > config.maxRecordingMs) {
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
		speechEndAt: () => speechEndAt,
		stop: () => stopSox("external stop"),
	}
}

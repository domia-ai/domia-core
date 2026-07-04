import { once } from "events"

import { type DomiaType } from "@/modules/core"
import { WAKE_WORD_ENGINE_ENUM_VALUES } from "@/db"
import {
	AUDIO_ERRORS,
	audioCaptureLogger,
	domiaError,
	normalizeRmsToDbfs,
} from "@/utils"
import { wakeWordEngines } from "../engines"
import {
	type CaptureCallbacksType,
	type CaptureHandleType,
	type StartAudioStreamResultType,
	type SpeculativeCaptureHooksType,
	type SpeculativeCaptureResultType,
	type FollowUpRecordingResultType,
	type FollowUpSpeculativeCaptureType,
} from "../types"
import {
	attachSoxStderrFilter,
	createStopSox,
	createVadWindow,
	ensureRecordingPath,
	int16BufferToFloat32,
	openMicSource,
	spawnSoxCapture,
	writePcmAsWav,
} from "../utils"
import {
	predictTurnComplete,
	turnDetectorAvailable,
} from "@/modules/turn-detector"

const ENDPOINT_DEBOUNCE_MIN_MS = 150
const ENDPOINT_DEBOUNCE_MAX_MS = 2000
const ACOUSTIC_GATE_COOLDOWN_MS = 250

const frameAlignedStart = (
	byteOffset: number,
	config: { bitsPerSample: number; channels: number },
): number => {
	const frameBytes = (config.bitsPerSample / 8) * config.channels
	return Math.floor(byteOffset / frameBytes) * frameBytes
}

export const startCapture = async (
	domia: DomiaType,
	callbacks?: CaptureCallbacksType,
): Promise<CaptureHandleType> => {
	const engine = domia?.wakeWordConfig?.engine
	if (!engine || !WAKE_WORD_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_ENGINE_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: { engine },
		})
	}
	return wakeWordEngines[engine](domia, callbacks)
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

	const watchdog = setTimeout(
		() => stopSox("watchdog timeout"),
		config.maxRecordingMs +
			config.vadMinSilenceS * 1000 +
			config.vadEndOfSpeechMs,
	)
	await once(sox, "close")
	clearTimeout(watchdog)
	await writePcmAsWav(
		outputPath,
		normalizeRmsToDbfs(Buffer.concat(captured)),
		config,
	)
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
	const pcm = Buffer.concat(captured).subarray(
		frameAlignedStart(speechStartByte, config),
	)
	await writePcmAsWav(outputPath, normalizeRmsToDbfs(pcm), config)
	return { filePath: outputPath, speechEndAt }
}

export const startSpeculativeCapture = (
	domia: DomiaType,
	hooks: SpeculativeCaptureHooksType,
	replaySinceTs?: number,
): SpeculativeCaptureResultType => {
	const config = domia.wakeWordConfig
	if (!config) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: { message: "Speculative capture requires wakeWordConfig" },
		})
	}
	const outputPath = ensureRecordingPath(domia.id)
	const source = openMicSource(
		domia,
		config,
		"speculative capture",
		replaySinceTs,
	)
	const vad = createVadWindow(config)
	const fastVad = createVadWindow(config, {
		minSilenceS: config.speculativeSilenceMs / 1000,
	})
	const stopSox = source.stop
	const captured: Buffer[] = []
	const startedAt = Date.now()
	const debounceMs = config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs
	const semantic = config.semanticEndpointingEnabled
	const acoustic =
		config.acousticEndpointingEnabled &&
		config.sampleRate === 16000 &&
		turnDetectorAvailable(config.turnDetectorModelPath)
	let currentDebounceMs = debounceMs
	const setDebounceMs = (ms: number): void => {
		currentDebounceMs = Math.max(
			ENDPOINT_DEBOUNCE_MIN_MS,
			Math.min(ENDPOINT_DEBOUNCE_MAX_MS, ms),
		)
	}
	let acousticChecking = false
	let acousticComplete = false
	let lastAcousticRunAt = 0
	const runAcousticGate = (): void => {
		if (acousticChecking || acousticComplete) return
		if (Date.now() - lastAcousticRunAt < ACOUSTIC_GATE_COOLDOWN_MS) return
		acousticChecking = true
		lastAcousticRunAt = Date.now()
		const pcm = int16BufferToFloat32(Buffer.concat(captured))
		void predictTurnComplete(
			pcm,
			config.turnDetectorModelPath,
			config.acousticEndpointCompleteThreshold,
		)
			.then((r) => {
				if (r) acousticComplete = r.complete
			})
			.finally(() => {
				acousticChecking = false
			})
	}
	const baseSilenceReached = (): boolean =>
		semantic
			? vad.everDetected() &&
				!vad.speechActive() &&
				vad.silenceMs() >= currentDebounceMs
			: vad.completed()
	const endpointReached = (): boolean => {
		const base = baseSilenceReached()
		if (!acoustic) return base
		if (base) runAcousticGate()
		return base && acousticComplete
	}
	let speculated = false
	let speechEndAt: number | null = null

	audioCaptureLogger.info(
		`[🎙️] Speculative capture started (commit at ${config.speculativeSilenceMs}ms raw silence${semantic ? ", semantic endpointing" : ""}${acoustic ? ", acoustic gate" : ""})`,
	)

	source.onData((data: Buffer) => {
		captured.push(data)
		vad.feed(data)
		fastVad.feed(data)
		hooks.onChunk?.(data)
		if (speculated && fastVad.speechActive()) {
			speculated = false
			currentDebounceMs = debounceMs
			hooks.onResume(Buffer.concat(captured))
		} else if (
			!speculated &&
			fastVad.everDetected() &&
			!fastVad.speechActive()
		) {
			speculated = true
			hooks.onSpeculate(Buffer.concat(captured))
		}
		if (endpointReached()) {
			speechEndAt = semantic
				? Date.now() - vad.silenceMs()
				: Date.now() - debounceMs
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
	const closePromise = source.closed.then(() => clearTimeout(watchdog))
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
		setDebounceMs,
	}
}

export const startFollowUpSpeculativeCapture = (
	domia: DomiaType,
): FollowUpSpeculativeCaptureType => {
	const config = domia.wakeWordConfig
	if (!config) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: {
				message: "Follow-up speculative capture requires wakeWordConfig",
			},
		})
	}
	const outputPath = ensureRecordingPath(domia.id)
	const source = openMicSource(domia, config, "follow-up speculative capture")
	const vad = createVadWindow(config)
	const fastVad = createVadWindow(config, {
		minSilenceS: config.speculativeSilenceMs / 1000,
	})
	const stopSox = source.stop
	const captured: Buffer[] = []
	const startedAt = Date.now()
	const bytesPerMs =
		(config.sampleRate * (config.bitsPerSample / 8) * config.channels) / 1000
	const debounceMs = config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs
	const semantic = config.semanticEndpointingEnabled
	let currentDebounceMs = debounceMs
	const setDebounceMs = (ms: number): void => {
		currentDebounceMs = Math.max(
			ENDPOINT_DEBOUNCE_MIN_MS,
			Math.min(ENDPOINT_DEBOUNCE_MAX_MS, ms),
		)
	}
	const endpointReached = (): boolean =>
		semantic
			? vad.everDetected() &&
				!vad.speechActive() &&
				vad.silenceMs() >= currentDebounceMs
			: vad.completed()
	let bytesSeen = 0
	let speechStartByte: number | null = null
	let speechEndAt: number | null = null
	let speculated = false
	let pendingSpeculate = false
	let hooks: SpeculativeCaptureHooksType | null = null
	let resolveSpeechStarted: (spoke: boolean) => void = () => undefined
	const speechStarted = new Promise<boolean>((resolve) => {
		resolveSpeechStarted = resolve
	})

	const trimmed = (): Buffer =>
		Buffer.concat(captured).subarray(
			frameAlignedStart(speechStartByte ?? 0, config),
		)

	audioCaptureLogger.info(
		`[🎙️] Follow-up speculative window open (${config.followUpWindowMs}ms, commit at ${config.speculativeSilenceMs}ms raw silence)`,
	)

	source.onData((data: Buffer) => {
		captured.push(data)
		bytesSeen += data.length
		vad.feed(data)
		if (speechStartByte === null) {
			if (vad.speechActive()) {
				speechStartByte = Math.max(
					0,
					bytesSeen - data.length - config.followUpLeadPadMs * bytesPerMs,
				)
				audioCaptureLogger.info(
					`[🎙️] Follow-up speech detected, speculative recording`,
				)
				fastVad.feed(data)
				resolveSpeechStarted(true)
				return
			}
			if (Date.now() - startedAt > config.followUpWindowMs) {
				stopSox("follow-up window expired with no speech")
			}
			return
		}
		fastVad.feed(data)
		hooks?.onChunk?.(data)
		if (speculated && fastVad.speechActive()) {
			speculated = false
			pendingSpeculate = false
			currentDebounceMs = debounceMs
			hooks?.onResume(trimmed())
		} else if (
			!speculated &&
			fastVad.everDetected() &&
			!fastVad.speechActive()
		) {
			speculated = true
			if (hooks) hooks.onSpeculate(trimmed())
			else pendingSpeculate = true
		}
		if (endpointReached()) {
			speechEndAt = semantic
				? Date.now() - vad.silenceMs()
				: Date.now() - debounceMs
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
		config.followUpWindowMs + config.maxRecordingMs + debounceMs,
	)
	const closePromise = source.closed.then(() => {
		clearTimeout(watchdog)
		resolveSpeechStarted(speechStartByte !== null)
	})
	const finalPcmPromise = closePromise.then(() => trimmed())
	const filePathPromise = finalPcmPromise.then(async (pcm) => {
		await writePcmAsWav(outputPath, pcm, config)
		return outputPath
	})

	return {
		speechStarted,
		stop: () => stopSox("external stop"),
		attach: (h) => {
			hooks = h
			const head = trimmed()
			if (head.length > 0) h.onChunk?.(head)
			if (pendingSpeculate) {
				pendingSpeculate = false
				h.onSpeculate(trimmed())
			}
			return {
				finalPcmPromise,
				filePathPromise,
				speechEndAt: () => speechEndAt,
				stop: () => stopSox("external stop"),
				setDebounceMs,
			}
		},
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

	const watchdog = setTimeout(
		() => stopSox("watchdog timeout"),
		config.maxRecordingMs + debounceMs,
	)
	const closePromise = new Promise<void>((resolve) => {
		sox.on("close", () => {
			clearTimeout(watchdog)
			resolve()
		})
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

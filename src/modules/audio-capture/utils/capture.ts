import type { SelectWakeWordConfigType } from "@/db"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { mkdirSync } from "fs"
import { writeFile } from "fs/promises"
import { join } from "path"

import {
	sileroVadEngine,
	getVadEngine,
	type VadTuningType,
} from "@/modules/vad"
import {
	audioCaptureLogger,
	generateUuid,
	int16BufferToFloat32,
	wrapPcmToWav,
} from "@/utils"
import type { DomiaType } from "@/modules/core"
import { RECORDINGS_DIR } from "../constants"
import type {
	CaptureFormatType,
	StopSoxType,
	VadWindowType,
	MicSourceType,
} from "../types"
import { micTapAvailable, tapMicStream } from "./mic-tap"
import { createCaptureEnhancer } from "@/modules/speech-enhancer"

const STOP_KILL_GRACE_MS = 2000

export const ensureRecordingPath = (domiaId: string | undefined): string => {
	mkdirSync(RECORDINGS_DIR, { recursive: true })
	return join(RECORDINGS_DIR, `${domiaId}_${generateUuid()}.wav`)
}

export const spawnSoxCapture = (
	format: CaptureFormatType,
): ChildProcessWithoutNullStreams => {
	const args = [
		"-q",
		"-d",
		"-t",
		"raw",
		"-r",
		String(format.sampleRate),
		"-e",
		"signed",
		"-b",
		String(format.bitsPerSample),
		"-c",
		String(format.channels),
		"-",
	]
	return spawn("sox", args)
}

export const attachSoxStderrFilter = (
	proc: ChildProcessWithoutNullStreams,
): void => {
	proc.stderr.on("data", (data: Buffer) => {
		const msg = data.toString().trim()
		if (!msg || msg.includes("can't set sample rate")) return
		audioCaptureLogger.warn(`[sox stderr]: ${msg}`)
	})
}

export const createVadWindow = (
	config: SelectWakeWordConfigType,
	tuningOverrides?: Partial<VadTuningType>,
): VadWindowType => {
	const engine = getVadEngine(config.vadEngine) ?? sileroVadEngine
	const session = engine.createSession(config.vadModelPath, {
		threshold: config.vadThreshold,
		minSilenceS: config.vadMinSilenceS,
		endOfSpeechMs: config.vadEndOfSpeechMs,
		numThreads: config.numThreads,
		provider: config.provider,
		...tuningOverrides,
	})
	const windowBytes = engine.capabilities.windowSize * 2
	const holdMs = Math.round(
		(tuningOverrides?.minSilenceS ?? config.vadMinSilenceS) * 1000,
	)
	let leftover = Buffer.alloc(0)

	return {
		feed: (data) => {
			leftover = Buffer.concat([leftover, data])
			while (leftover.length >= windowBytes) {
				const window = leftover.subarray(0, windowBytes)
				leftover = leftover.subarray(windowBytes)
				session.acceptSamples(int16BufferToFloat32(window))
			}
		},
		completed: () => session.hasCompletedSegment(),
		speechActive: () => session.isSpeechActive(),
		silenceMs: () => session.silenceMs(),
		holdMs: () => holdMs,
		everDetected: () => session.everDetected(),
	}
}

export const createStopSox = (
	proc: ChildProcessWithoutNullStreams,
	context: string,
): StopSoxType => {
	let stopped = false
	return (reason) => {
		if (stopped) return
		stopped = true
		audioCaptureLogger.info(`[🎙️] Stopping ${context} (${reason})`)
		proc.kill("SIGTERM")
		const killTimer = setTimeout(() => {
			if (proc.exitCode === null && proc.signalCode === null) {
				try {
					proc.kill("SIGKILL")
				} catch {
					/* empty */
				}
			}
		}, STOP_KILL_GRACE_MS)
		killTimer.unref()
	}
}

export const writePcmAsWav = async (
	outputPath: string,
	pcm: Buffer,
	format: CaptureFormatType,
): Promise<void> => {
	const wav = wrapPcmToWav(
		pcm,
		format.sampleRate,
		format.channels,
		format.bitsPerSample,
	)
	await writeFile(outputPath, wav)
	audioCaptureLogger.info(`[🎙️] Saved ${pcm.length} bytes to ${outputPath}`)
}

export const openMicSource = (
	domia: DomiaType,
	config: SelectWakeWordConfigType,
	label: string,
	replaySinceTs?: number,
): MicSourceType => {
	if (config.sharedMicStreamEnabled && micTapAvailable(domia.id, config)) {
		let unsubscribe: (() => void) | null = null
		let resolveClosed: () => void = () => undefined
		const closed = new Promise<void>((resolve) => {
			resolveClosed = resolve
		})
		audioCaptureLogger.info(`[🎙️] ${label}: using shared mic tap`)
		return {
			viaTap: true,
			onData: (handler) => {
				unsubscribe = tapMicStream(domia.id, handler, replaySinceTs)
			},
			stop: (reason) => {
				if (!unsubscribe) return
				audioCaptureLogger.info(`[🎙️] Stopping ${label} (${reason})`)
				unsubscribe()
				unsubscribe = null
				resolveClosed()
			},
			closed,
		}
	}
	const sox = spawnSoxCapture(config)
	attachSoxStderrFilter(sox)
	const stopSox = createStopSox(sox, label)
	const enhancer = createCaptureEnhancer(config, label)
	let dataHandler: ((data: Buffer) => void) | null = null
	const closed = new Promise<void>((resolve) => {
		sox.on("close", () => {
			const tail = enhancer.flush()
			if (tail.length > 0) dataHandler?.(tail)
			enhancer.close()
			resolve()
		})
	})
	return {
		viaTap: false,
		onData: (handler) => {
			dataHandler = handler
			sox.stdout.on("data", (raw: Buffer) => {
				const data = enhancer.process(raw)
				if (data.length > 0) handler(data)
			})
		},
		stop: (reason) => stopSox(reason),
		closed,
	}
}

export const enhancedSoxData = (
	sox: ChildProcessWithoutNullStreams,
	config: SelectWakeWordConfigType,
	label: string,
	handler: (data: Buffer) => void,
): void => {
	const enhancer = createCaptureEnhancer(config, label)
	sox.stdout.on("data", (raw: Buffer) => {
		const data = enhancer.process(raw)
		if (data.length > 0) handler(data)
	})
	sox.on("close", () => {
		const tail = enhancer.flush()
		if (tail.length > 0) handler(tail)
		enhancer.close()
	})
}

export const enhancedSoxChunks = (
	sox: ChildProcessWithoutNullStreams,
	config: SelectWakeWordConfigType,
	label: string,
): AsyncIterable<Buffer> => {
	const enhancer = createCaptureEnhancer(config, label)
	return (async function* () {
		try {
			for await (const raw of sox.stdout) {
				const data = enhancer.process(raw as Buffer)
				if (data.length > 0) yield data
			}
			const tail = enhancer.flush()
			if (tail.length > 0) yield tail
		} finally {
			enhancer.close()
		}
	})()
}

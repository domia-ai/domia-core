import type { SelectWakeWordConfigType } from "@/db"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { mkdirSync } from "fs"
import { writeFile } from "fs/promises"
import { join } from "path"

import { sileroVadEngine, type VadTuningType } from "@/modules/vad"
import { audioCaptureLogger, generateUuid, wrapPcmToWav } from "@/utils"
import type { DomiaType } from "@/modules/core"
import { RECORDINGS_DIR } from "../constants"
import type {
	CaptureFormatType,
	StopSoxType,
	VadWindowType,
	MicSourceType,
} from "../types"
import { micTapAvailable, tapMicStream } from "./mic-tap"

const STDERR_NOISE_PATTERN = /can't set sample rate/
const INT16_MAX = 32768
const STOP_KILL_GRACE_MS = 2000

export const int16BufferToFloat32 = (chunk: Buffer): Float32Array => {
	const samples = new Float32Array(chunk.length / 2)
	for (let i = 0; i < samples.length; i++) {
		samples[i] = chunk.readInt16LE(i * 2) / INT16_MAX
	}
	return samples
}

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
		if (!msg || STDERR_NOISE_PATTERN.test(msg)) return
		audioCaptureLogger.warn(`[sox stderr]: ${msg}`)
	})
}

export const createVadWindow = (
	config: SelectWakeWordConfigType,
	tuningOverrides?: Partial<VadTuningType>,
): VadWindowType => {
	const session = sileroVadEngine.createSession(config.vadModelPath, {
		threshold: config.vadThreshold,
		minSilenceS: config.vadMinSilenceS,
		endOfSpeechMs: config.vadEndOfSpeechMs,
		numThreads: config.numThreads,
		provider: config.provider,
		...tuningOverrides,
	})
	const windowBytes = sileroVadEngine.windowSize * 2
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
					/* */
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

export {
	publishMicChunk,
	setMicTapFormat,
	micTapAvailable,
	tapMicStream,
} from "./mic-tap"

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
	const closed = new Promise<void>((resolve) => {
		sox.on("close", () => resolve())
	})
	return {
		viaTap: false,
		onData: (handler) => {
			sox.stdout.on("data", handler)
		},
		stop: (reason) => stopSox(reason),
		closed,
	}
}

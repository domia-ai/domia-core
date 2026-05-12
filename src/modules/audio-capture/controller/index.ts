import { spawn } from "child_process"
import { mkdirSync, writeFileSync } from "fs"
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
import { sileroVadEngine } from "@/modules/vad"
import { wakeWordEngines } from "../engines"
import {
	type CaptureCallbacksType,
	type StartAudioStreamResultType,
} from "../types"
import { RECORDINGS_DIR } from "../constants"

const SAMPLE_RATE = 16000
const BITS_PER_SAMPLE = 16
const CHANNELS = 1
const MAX_RECORDING_MS = 15000

const int16BufferToFloat32 = (chunk: Buffer): Float32Array => {
	const samples = new Float32Array(chunk.length / 2)
	for (let i = 0; i < samples.length; i++) {
		samples[i] = chunk.readInt16LE(i * 2) / 32768
	}
	return samples
}

const wrapPcmToWav = (
	pcm: Buffer,
	sampleRate: number,
	channels: number,
	bitsPerSample: number,
): Buffer => {
	const byteRate = (sampleRate * channels * bitsPerSample) / 8
	const blockAlign = (channels * bitsPerSample) / 8
	const dataSize = pcm.length
	const buf = Buffer.alloc(44 + dataSize)
	buf.write("RIFF", 0)
	buf.writeUInt32LE(36 + dataSize, 4)
	buf.write("WAVE", 8)
	buf.write("fmt ", 12)
	buf.writeUInt32LE(16, 16)
	buf.writeUInt16LE(1, 20)
	buf.writeUInt16LE(channels, 22)
	buf.writeUInt32LE(sampleRate, 24)
	buf.writeUInt32LE(byteRate, 28)
	buf.writeUInt16LE(blockAlign, 32)
	buf.writeUInt16LE(bitsPerSample, 34)
	buf.write("data", 36)
	buf.writeUInt32LE(dataSize, 40)
	pcm.copy(buf, 44)
	return buf
}

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

	const vadModelPath = domia.wakeWordConfig?.vadModelPath
	if (!vadModelPath) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: {
				message:
					"Recording requires wakeWordConfig.vadModelPath (path to VAD onnx file)",
			},
		})
	}
	const session = sileroVadEngine.createSession(vadModelPath)
	const captured: Buffer[] = []
	const startedAt = Date.now()
	const windowBytes = sileroVadEngine.windowSize * 2

	const args = [
		"-q",
		"-d",
		"-t",
		"raw",
		"-r",
		String(SAMPLE_RATE),
		"-e",
		"signed",
		"-b",
		String(BITS_PER_SAMPLE),
		"-c",
		String(CHANNELS),
		"-",
	]

	audioCaptureLogger.info(`[🎙️] Starting VAD-gated recording to: ${outputPath}`)
	const sox = spawn("sox", args)

	sox.stderr.on("data", (data: Buffer) => {
		const msg = data.toString().trim()
		if (!msg) return
		if (/can't set sample rate/.test(msg)) return
		audioCaptureLogger.warn(`[sox stderr]: ${msg}`)
	})

	let leftover = Buffer.alloc(0)
	let stopped = false

	const stopSox = (reason: string) => {
		if (stopped) return
		stopped = true
		audioCaptureLogger.info(`[🎙️] Stopping recording (${reason})`)
		sox.kill("SIGTERM")
	}

	sox.stdout.on("data", (data: Buffer) => {
		captured.push(data)
		leftover = Buffer.concat([leftover, data])
		while (leftover.length >= windowBytes) {
			const chunk = leftover.subarray(0, windowBytes)
			leftover = leftover.subarray(windowBytes)
			session.acceptSamples(int16BufferToFloat32(chunk))
		}

		if (session.hasCompletedSegment()) {
			stopSox("vad detected end of speech")
		} else if (Date.now() - startedAt > MAX_RECORDING_MS) {
			stopSox("max recording duration reached")
		}
	})

	sox.on("close", (code) => {
		audioCaptureLogger.info(`[🎙️] Recording finished with code ${code ?? 0}`)
	})

	await once(sox, "close")

	const pcm = Buffer.concat(captured)
	writeFileSync(
		outputPath,
		wrapPcmToWav(pcm, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE),
	)
	audioCaptureLogger.info(`[🎙️] Saved ${pcm.length} bytes to ${outputPath}`)

	return outputPath
}

export const startAudioStream = (
	domia: DomiaType,
): StartAudioStreamResultType => {
	mkdirSync(RECORDINGS_DIR, { recursive: true })
	const filename = `${domia?.id}_${generateUuid()}.wav`
	const outputPath = join(RECORDINGS_DIR, filename)

	const args = [
		"-d",
		"-t",
		"raw",
		"-r",
		"16000",
		"-e",
		"signed",
		"-b",
		"16",
		"-c",
		"1",
		"-",
		"silence",
		"1",
		"0.1",
		"1%",
		"1",
		"0.5",
		"3%",
	]

	audioCaptureLogger.info(
		`[🎙️] Starting streaming capture (file: ${outputPath})`,
	)
	const sox = spawn("sox", args)
	sox.stderr.on("data", (data) => {
		audioCaptureLogger.warn(`[sox stderr]: ${data}`)
	})

	const captured: Buffer[] = []
	const closePromise = new Promise<void>((resolve) => {
		sox.on("close", () => resolve())
	})

	const chunks = (async function* () {
		for await (const chunk of sox.stdout) {
			const buf = chunk as Buffer
			captured.push(buf)
			yield buf
		}
	})()

	const filePathPromise = (async () => {
		await closePromise
		const raw = Buffer.concat(captured)
		const wavBuf = wrapPcmToWav(raw, 16000, 1, 16)
		await import("fs/promises").then((fs) => fs.writeFile(outputPath, wavBuf))
		audioCaptureLogger.info(`[🎙️] Streaming capture saved to ${outputPath}`)
		return outputPath
	})()

	return {
		chunks,
		filePathPromise,
		stop: () => sox.kill(),
	}
}

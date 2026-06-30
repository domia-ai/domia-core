import { spawn } from "child_process"
import fs from "fs"
import path from "path"

import { type DomiaType } from "@/modules/core"
import { getIntercom } from "@/modules/core-bus/utils/intercom-registry"
import {
	audioCaptureLogger,
	domiaError,
	AUDIO_ERRORS,
	findOnnxFile,
	resolveQuantization,
	type QuantizationType,
} from "@/utils"
import { createKeywordSpotter } from "@/utils/ml-runtime"

import { type CaptureCallbacksType, type KwsPathsType } from "../../types"

const SAMPLE_RATE = 16000
const CHUNK_SAMPLES = 1600

const resolveKwsPaths = (
	modelDir: string,
	quantization: QuantizationType,
): KwsPathsType | null => {
	const dir = path.resolve(modelDir)
	if (!fs.existsSync(dir)) return null
	const encoder = findOnnxFile({ dir, prefix: "encoder", quantization })
	const decoder = findOnnxFile({ dir, prefix: "decoder", quantization })
	const joiner = findOnnxFile({ dir, prefix: "joiner", quantization })
	if (!encoder || !decoder || !joiner) return null
	return {
		dir,
		encoder,
		decoder,
		joiner,
		tokens: path.join(dir, "tokens.txt"),
		keywords: path.join(dir, "keywords.txt"),
	}
}

const int16BufferToFloat32 = (chunk: Buffer): Float32Array => {
	const samples = new Float32Array(chunk.length / 2)
	for (let i = 0; i < samples.length; i++) {
		samples[i] = chunk.readInt16LE(i * 2) / 32768
	}
	return samples
}

export const runKws = async (
	domia: DomiaType,
	callbacks?: CaptureCallbacksType,
) => {
	const wakeWordConfig = domia.wakeWordConfig
	if (!wakeWordConfig) {
		const err = domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
		})
		callbacks?.onError?.(err)
		throw err
	}

	const modelPath = wakeWordConfig.customModelPath
	if (!modelPath) {
		const err = new Error(
			"KWS requires wakeWordConfig.customModelPath (model directory)",
		)
		callbacks?.onError?.(err)
		throw err
	}

	const quantization = resolveQuantization(wakeWordConfig.quantization)
	const paths = resolveKwsPaths(modelPath, quantization)
	if (!paths) {
		const err = new Error(
			`KWS model files missing or incomplete at ${modelPath}. Run npm run setup:models:kws`,
		)
		callbacks?.onError?.(err)
		throw err
	}

	const missing = [paths.tokens, paths.keywords].filter(
		(p) => !fs.existsSync(p),
	)
	if (missing.length > 0) {
		const err = new Error(`KWS missing required files: ${missing.join(", ")}`)
		callbacks?.onError?.(err)
		throw err
	}

	const cooldownMs = Math.round(wakeWordConfig.cooldown * 1000)
	const config = {
		featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
		modelConfig: {
			transducer: {
				encoder: paths.encoder,
				decoder: paths.decoder,
				joiner: paths.joiner,
			},
			tokens: paths.tokens,
			numThreads: wakeWordConfig.numThreads,
			provider: wakeWordConfig.provider,
			debug: 0,
		},
		keywordsFile: paths.keywords,
		keywordsThreshold: wakeWordConfig.threshold,
		keywordsScore: wakeWordConfig.sensitivity,
	}

	audioCaptureLogger.info("🎤 Starting KWS wake-word engine", {
		domiaId: domia.id,
		modelDir: paths.dir,
		quantization,
		encoder: paths.encoder,
		keywordsFile: paths.keywords,
	})

	const kws = createKeywordSpotter(config)
	const stream = kws.createStream()
	let lastDetectionAt = 0

	const recProc = spawn("rec", [
		"-q",
		"-t",
		"raw",
		"-r",
		String(SAMPLE_RATE),
		"-e",
		"signed",
		"-b",
		"16",
		"-c",
		"1",
		"-",
	])

	let leftover = Buffer.alloc(0)
	const targetBytes = CHUNK_SAMPLES * 2

	recProc.stdout.on("data", (data: Buffer) => {
		const intercom = getIntercom(domia.domiaKey)
		if (intercom) void intercom.sink.write(data)
		leftover = Buffer.concat([leftover, data])
		while (leftover.length >= targetBytes) {
			const chunk = leftover.subarray(0, targetBytes)
			leftover = leftover.subarray(targetBytes)
			const samples = int16BufferToFloat32(chunk)
			stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
			while (kws.isReady(stream)) {
				kws.decode(stream)
				const result = kws.getResult(stream)
				if (result.keyword && result.keyword.length > 0) {
					const now = Date.now()
					if (now - lastDetectionAt > cooldownMs) {
						lastDetectionAt = now
						audioCaptureLogger.info("✨ wake detected", {
							keyword: result.keyword,
						})
						kws.reset(stream)
						callbacks?.onWake?.()
					}
				}
			}
		}
	})

	recProc.stderr.on("data", (data: Buffer) => {
		const msg = data.toString().trim()
		if (!msg) return
		if (/can't set sample rate/.test(msg)) return
		audioCaptureLogger.warn(`[kws:rec] ${msg}`)
	})

	recProc.on("error", (err) => {
		audioCaptureLogger.error("[kws:rec] error", { err })
		callbacks?.onError?.(err)
	})

	recProc.on("close", (code) => {
		audioCaptureLogger.info(`[kws] rec process terminated code=${code}`)
	})

	return {
		stop: () => {
			try {
				recProc.kill()
			} catch {
				/* already gone */
			}
		},
	}
}

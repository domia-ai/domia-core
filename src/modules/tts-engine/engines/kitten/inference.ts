import fs from "fs"
import path from "path"

import { ttsEngineLogger, TTS_ERRORS, domiaError } from "@/utils"
import { createOfflineTts, type OfflineTtsInstance } from "@/utils/ml-runtime"

import { float32ToInt16Buffer } from "../kokoro/inference"
import type { KittenWorkerJobType, TtsWorkerResultType } from "../../types"

let cachedEngine: OfflineTtsInstance | null = null
let cachedKey: string | null = null

const getEngine = (
	config: KittenWorkerJobType["engineConfig"],
): OfflineTtsInstance => {
	const dir = path.resolve(config.modelPath)
	const key = `${dir}|${config.numThreads}|${config.provider}|${config.lengthScale}`
	if (cachedEngine && cachedKey === key) return cachedEngine
	const model = path.join(dir, "model.fp16.onnx")
	const modelPath = fs.existsSync(model) ? model : path.join(dir, "model.onnx")
	if (!fs.existsSync(modelPath))
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "Kitten model .onnx not found", dir },
		})
	ttsEngineLogger.info("🚀 Loading Kitten TTS", {
		modelDir: dir,
		numThreads: config.numThreads,
		provider: config.provider,
		pid: process.pid,
	})
	cachedEngine = createOfflineTts({
		model: {
			kitten: {
				model: modelPath,
				voices: path.join(dir, "voices.bin"),
				tokens: path.join(dir, "tokens.txt"),
				dataDir: config.espeakDataDir?.trim()
					? path.resolve(config.espeakDataDir)
					: path.join(dir, "espeak-ng-data"),
				lengthScale: config.lengthScale,
			},
			debug: false,
			numThreads: config.numThreads,
			provider: config.provider,
		},
		maxNumSentences: config.maxNumSentences,
	})
	cachedKey = key
	return cachedEngine
}

export const synthesizeKittenPcm = (
	job: KittenWorkerJobType,
): TtsWorkerResultType => {
	const engine = getEngine(job.engineConfig)
	const audio = engine.generate({
		text: job.text,
		generationConfig: { sid: job.sid, speed: job.speed },
	})
	return {
		pcm: float32ToInt16Buffer(audio.samples),
		sampleRate: audio.sampleRate,
		channels: 1,
	}
}

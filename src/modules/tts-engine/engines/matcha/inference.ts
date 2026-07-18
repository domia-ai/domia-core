import fs from "fs"
import path from "path"

import { ttsEngineLogger, TTS_ERRORS, domiaError } from "@/utils"
import { createOfflineTts, type OfflineTtsInstance } from "@/utils/ml-runtime"

import { float32ToInt16Buffer } from "../kokoro/inference"
import type { MatchaWorkerJobType, TtsWorkerResultType } from "../../types"

let cachedEngine: OfflineTtsInstance | null = null
let cachedKey: string | null = null

const findAcousticModel = (dir: string): string | null => {
	const preferred = ["model-steps-3.onnx", "model-steps-2.onnx", "model.onnx"]
	for (const f of preferred) {
		const p = path.join(dir, f)
		if (fs.existsSync(p)) return p
	}
	const found = fs
		.readdirSync(dir)
		.find((f) => f.endsWith(".onnx") && !f.includes("vocoder"))
	return found ? path.join(dir, found) : null
}

const getEngine = (
	config: MatchaWorkerJobType["engineConfig"],
): OfflineTtsInstance => {
	const dir = path.resolve(config.modelPath)
	const key = `${dir}|${config.vocoderPath}|${config.numThreads}|${config.provider}|${config.lengthScale}`
	if (cachedEngine && cachedKey === key) return cachedEngine
	const acousticModel = findAcousticModel(dir)
	const vocoder = path.resolve(config.vocoderPath)
	if (!acousticModel || !fs.existsSync(vocoder))
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				message: "Matcha acoustic model or vocoder not found",
				dir,
				vocoder,
			},
		})
	ttsEngineLogger.info("🚀 Loading Matcha TTS", {
		modelDir: dir,
		vocoder,
		numThreads: config.numThreads,
		provider: config.provider,
		pid: process.pid,
	})
	cachedEngine = createOfflineTts({
		model: {
			matcha: {
				acousticModel,
				vocoder,
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

export const synthesizeMatchaPcm = (
	job: MatchaWorkerJobType,
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

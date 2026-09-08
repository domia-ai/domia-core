import path from "path"

import { ttsEngineLogger } from "@/utils"
import { createOfflineTts, type OfflineTtsInstance } from "@/utils/ml-runtime"

import { float32ToInt16Buffer } from "../kokoro/inference"
import type {
	SupertonicWorkerEngineConfigType,
	SupertonicWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

export const SUPERTONIC_SAMPLE_RATE = 44100

let cachedEngine: OfflineTtsInstance | null = null
let cachedEngineKey: string | null = null

const configKey = (config: SupertonicWorkerEngineConfigType): string =>
	`${path.resolve(config.modelPath)}|${config.numThreads}|${config.provider}|${config.maxNumSentences}`

const getEngine = (
	config: SupertonicWorkerEngineConfigType,
): OfflineTtsInstance => {
	const dir = path.resolve(config.modelPath)
	const key = configKey(config)
	if (cachedEngine && cachedEngineKey === key) return cachedEngine
	ttsEngineLogger.info("🚀 Loading Supertonic TTS", {
		modelDir: dir,
		numThreads: config.numThreads,
		provider: config.provider,
		pid: process.pid,
	})
	cachedEngine = createOfflineTts({
		model: {
			supertonic: {
				durationPredictor: path.join(dir, "duration_predictor.int8.onnx"),
				textEncoder: path.join(dir, "text_encoder.int8.onnx"),
				vectorEstimator: path.join(dir, "vector_estimator.int8.onnx"),
				vocoder: path.join(dir, "vocoder.int8.onnx"),
				ttsJson: path.join(dir, "tts.json"),
				unicodeIndexer: path.join(dir, "unicode_indexer.bin"),
				voiceStyle: path.join(dir, "voice.bin"),
			},
			debug: false,
			numThreads: config.numThreads,
			provider: config.provider,
		},
		maxNumSentences: config.maxNumSentences,
	})
	cachedEngineKey = key
	return cachedEngine
}

export const synthesizeSupertonicPcm = (
	job: SupertonicWorkerJobType,
): TtsWorkerResultType => {
	const engine = getEngine(job.engineConfig)
	const audio = engine.generate({
		text: job.text,
		generationConfig: {
			sid: job.sid,
			speed: job.speed,
			numSteps: job.engineConfig.numSteps,
			extra: { lang: job.lang },
		},
	})
	return {
		pcm: float32ToInt16Buffer(audio.samples),
		sampleRate: audio.sampleRate || SUPERTONIC_SAMPLE_RATE,
		channels: 1,
	}
}

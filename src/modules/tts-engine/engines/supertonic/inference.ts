import path from "path"

import { ttsEngineLogger, TTS_ERRORS, domiaError } from "@/utils"
import { createOfflineTts, type OfflineTtsInstance } from "@/utils/ml-runtime"
import { findOnnxFile, resolveQuantization } from "@/utils/model-paths"

import { float32ToInt16Buffer } from "../kokoro/inference"
import type {
	SupertonicPathsType,
	SupertonicWorkerEngineConfigType,
	SupertonicWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

export const SUPERTONIC_SAMPLE_RATE = 44100

const ONNX_PREFIXES = {
	durationPredictor: "duration_predictor",
	textEncoder: "text_encoder",
	vectorEstimator: "vector_estimator",
	vocoder: "vocoder",
} as const

let cachedEngine: OfflineTtsInstance | null = null
let cachedEngineKey: string | null = null

export const resolveSupertonicPaths = (
	modelPath: string,
	quantization: string | null | undefined,
): SupertonicPathsType => {
	const dir = path.resolve(modelPath)
	const q = resolveQuantization(quantization)
	const found = Object.entries(ONNX_PREFIXES).map(
		([field, prefix]) =>
			[field, findOnnxFile({ dir, prefix, quantization: q })] as const,
	)
	const missing = found.filter(([, file]) => file === null).map(([f]) => f)
	if (missing.length > 0)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				message: `Supertonic model files missing at ${dir}. Run: bash scripts/download-models.sh supertonic`,
				dir,
				missing,
			},
		})
	const onnx = Object.fromEntries(found) as Record<
		keyof typeof ONNX_PREFIXES,
		string
	>
	return {
		dir,
		...onnx,
		ttsJson: path.join(dir, "tts.json"),
		unicodeIndexer: path.join(dir, "unicode_indexer.bin"),
		voiceStyle: path.join(dir, "voice.bin"),
	}
}

const configKey = (config: SupertonicWorkerEngineConfigType): string =>
	`${path.resolve(config.modelPath)}|${config.numThreads}|${config.provider}|${config.maxNumSentences}|${config.quantization}`

const getEngine = (
	config: SupertonicWorkerEngineConfigType,
): OfflineTtsInstance => {
	const key = configKey(config)
	if (cachedEngine && cachedEngineKey === key) return cachedEngine
	const paths = resolveSupertonicPaths(config.modelPath, config.quantization)
	ttsEngineLogger.info("🚀 Loading Supertonic TTS", {
		modelDir: paths.dir,
		numThreads: config.numThreads,
		provider: config.provider,
		pid: process.pid,
	})
	cachedEngine = createOfflineTts({
		model: {
			supertonic: {
				durationPredictor: paths.durationPredictor,
				textEncoder: paths.textEncoder,
				vectorEstimator: paths.vectorEstimator,
				vocoder: paths.vocoder,
				ttsJson: paths.ttsJson,
				unicodeIndexer: paths.unicodeIndexer,
				voiceStyle: paths.voiceStyle,
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

import path from "path"

import { ttsEngineLogger } from "@/utils"
import {
	createOfflineTts,
	readWave,
	type OfflineTtsInstance,
	type Waveform,
} from "@/utils/ml-runtime"
import { DEFAULT_POCKET_REFERENCE_WAV } from "@/db"

import { float32ToInt16Buffer } from "../kokoro/inference"
import type {
	PocketWorkerEngineConfigType,
	PocketWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

export const POCKET_SAMPLE_RATE = 24000

let cachedEngine: OfflineTtsInstance | null = null
let cachedEngineKey: string | null = null
let cachedReference: Waveform | null = null
let cachedReferencePath: string | null = null

const configKey = (config: PocketWorkerEngineConfigType): string =>
	`${path.resolve(config.modelPath)}|${config.numThreads}|${config.provider}|${config.voiceEmbeddingCacheCapacity}`

const getEngine = (
	config: PocketWorkerEngineConfigType,
): OfflineTtsInstance => {
	const dir = path.resolve(config.modelPath)
	const key = configKey(config)
	if (cachedEngine && cachedEngineKey === key) return cachedEngine
	ttsEngineLogger.info("🚀 Loading Pocket TTS", {
		modelDir: dir,
		numThreads: config.numThreads,
		provider: config.provider,
		pid: process.pid,
	})
	cachedEngine = createOfflineTts({
		model: {
			pocket: {
				lmFlow: path.join(dir, "lm_flow.int8.onnx"),
				lmMain: path.join(dir, "lm_main.int8.onnx"),
				encoder: path.join(dir, "encoder.onnx"),
				decoder: path.join(dir, "decoder.int8.onnx"),
				textConditioner: path.join(dir, "text_conditioner.onnx"),
				vocabJson: path.join(dir, "vocab.json"),
				tokenScoresJson: path.join(dir, "token_scores.json"),
				voiceEmbeddingCacheCapacity: config.voiceEmbeddingCacheCapacity,
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

const getReference = (config: PocketWorkerEngineConfigType): Waveform => {
	const refPath = config.referenceAudioPath
		? path.resolve(config.referenceAudioPath)
		: path.join(path.resolve(config.modelPath), DEFAULT_POCKET_REFERENCE_WAV)
	if (cachedReference && cachedReferencePath === refPath) return cachedReference
	cachedReference = readWave(refPath)
	cachedReferencePath = refPath
	return cachedReference
}

export const synthesizePocketPcmStream = async (
	job: PocketWorkerJobType,
	emit: (pcm: Buffer) => void,
): Promise<TtsWorkerResultType> => {
	const engine = getEngine(job.engineConfig)
	const reference = getReference(job.engineConfig)
	await engine.generateAsync({
		text: job.text,
		generationConfig: {
			speed: job.speed,
			referenceAudio: reference.samples,
			referenceSampleRate: reference.sampleRate,
			numSteps: job.engineConfig.numSteps,
		},
		onProgress: (info) => {
			if (info.samples.length > 0) emit(float32ToInt16Buffer(info.samples))
			return 1
		},
	})
	return {
		pcm: Buffer.alloc(0),
		sampleRate: POCKET_SAMPLE_RATE,
		channels: 1,
	}
}

export const synthesizePocketPcm = (
	job: PocketWorkerJobType,
): TtsWorkerResultType => {
	const engine = getEngine(job.engineConfig)
	const reference = getReference(job.engineConfig)
	const audio = engine.generate({
		text: job.text,
		generationConfig: {
			speed: job.speed,
			referenceAudio: reference.samples,
			referenceSampleRate: reference.sampleRate,
			numSteps: job.engineConfig.numSteps,
		},
	})
	return {
		pcm: float32ToInt16Buffer(audio.samples),
		sampleRate: POCKET_SAMPLE_RATE,
		channels: 1,
	}
}

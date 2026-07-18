import { readdirSync } from "fs"
import path from "path"

import { ttsEngineLogger, TTS_ERRORS, domiaError } from "@/utils"
import { createOfflineTts, type OfflineTtsInstance } from "@/utils/ml-runtime"

import { float32ToInt16Buffer } from "../kokoro/inference"
import type {
	VitsWorkerEngineConfigType,
	VitsWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

let cachedEngine: OfflineTtsInstance | null = null
let cachedKey: string | null = null

const findModelFile = (dir: string): string | null => {
	const files = readdirSync(dir).filter(
		(f) => f.endsWith(".onnx") && !f.includes("vocoder"),
	)
	return files.length > 0 ? path.join(dir, files[0]) : null
}

const configKey = (config: VitsWorkerEngineConfigType): string =>
	`${path.resolve(config.modelPath)}|${config.numThreads}|${config.provider}`

const getEngine = (config: VitsWorkerEngineConfigType): OfflineTtsInstance => {
	const dir = path.resolve(config.modelPath)
	const key = configKey(config)
	if (cachedEngine && cachedKey === key) return cachedEngine
	const model = findModelFile(dir)
	if (!model)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "VITS model .onnx not found", dir },
		})
	ttsEngineLogger.info("🚀 Loading VITS TTS", {
		modelDir: dir,
		numThreads: config.numThreads,
		provider: config.provider,
		pid: process.pid,
	})
	cachedEngine = createOfflineTts({
		model: {
			vits: {
				model,
				tokens: path.join(dir, "tokens.txt"),
				dataDir: config.espeakDataDir?.trim()
					? path.resolve(config.espeakDataDir)
					: path.join(dir, "espeak-ng-data"),
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

export const synthesizeVitsPcm = (
	job: VitsWorkerJobType,
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

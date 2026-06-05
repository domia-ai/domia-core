import fs from "fs"
import path from "path"

import { ttsEngineLogger, TTS_ERRORS, domiaError } from "@/utils"
import { createOfflineTts, type OfflineTtsInstance } from "@/utils/ml-runtime"
import type {
	KokoroPathsType,
	TtsWorkerEngineConfigType,
	TtsWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

let cachedEngine: OfflineTtsInstance | null = null
let cachedKey: string | null = null

const resolvePaths = (modelDir: string): KokoroPathsType => {
	const dir = path.resolve(modelDir)
	return {
		dir,
		model: path.join(dir, "model.onnx"),
		voices: path.join(dir, "voices.bin"),
		tokens: path.join(dir, "tokens.txt"),
		dataDir: path.join(dir, "espeak-ng-data"),
	}
}

const validatePaths = (paths: KokoroPathsType): void => {
	const missing = [
		paths.model,
		paths.voices,
		paths.tokens,
		paths.dataDir,
	].filter((p) => !fs.existsSync(p))
	if (!fs.existsSync(paths.dir) || missing.length > 0) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				message: `Kokoro model files missing at ${paths.dir}. Run npm run setup:models:kokoro`,
				dir: paths.dir,
				missing,
			},
		})
	}
}

const buildConfig = (
	paths: KokoroPathsType,
	engineConfig: TtsWorkerEngineConfigType,
) => ({
	model: {
		kokoro: {
			model: paths.model,
			voices: paths.voices,
			tokens: paths.tokens,
			dataDir: paths.dataDir,
		},
		debug: false,
		numThreads: engineConfig.numThreads,
		provider: engineConfig.provider,
	},
	maxNumSentences: engineConfig.maxNumSentences,
})

const configKey = (config: TtsWorkerEngineConfigType): string =>
	`${path.resolve(config.modelPath)}|${config.numThreads}|${config.provider}|${config.maxNumSentences}`

const getEngine = (
	engineConfig: TtsWorkerEngineConfigType,
): OfflineTtsInstance => {
	const key = configKey(engineConfig)
	if (!cachedEngine || cachedKey !== key) {
		const paths = resolvePaths(engineConfig.modelPath)
		validatePaths(paths)
		ttsEngineLogger.info("🚀 Loading Kokoro TTS", {
			modelDir: paths.dir,
			numThreads: engineConfig.numThreads,
			provider: engineConfig.provider,
			maxNumSentences: engineConfig.maxNumSentences,
			pid: process.pid,
		})
		cachedEngine = createOfflineTts(buildConfig(paths, engineConfig))
		cachedKey = key
	}
	return cachedEngine
}

export const float32ToInt16Buffer = (samples: Float32Array): Buffer => {
	const out = Buffer.alloc(samples.length * 2)
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]))
		out.writeInt16LE(Math.round(clamped * 32767), i * 2)
	}
	return out
}

const resolveValidSid = (sid: number, numSpeakers: number): number => {
	if (sid >= 0 && sid < numSpeakers) return sid
	ttsEngineLogger.warn(
		`⚠️ sid ${sid} out of range for model (${numSpeakers} speakers) — using default voice (sid 0)`,
		{ sid, numSpeakers },
	)
	return 0
}

export const synthesizeKokoroSamples = (
	engineConfig: TtsWorkerEngineConfigType,
	params: { text: string; sid: number; speed: number; silenceScale: number },
): { samples: Float32Array; sampleRate: number } => {
	const engine = getEngine(engineConfig)
	const audio = engine.generate({
		text: params.text,
		generationConfig: {
			sid: resolveValidSid(params.sid, engine.numSpeakers),
			speed: params.speed,
			silenceScale: params.silenceScale,
		},
	})
	return { samples: audio.samples, sampleRate: audio.sampleRate }
}

export const synthesizeKokoroPcm = (
	job: TtsWorkerJobType,
): TtsWorkerResultType => {
	const { samples, sampleRate } = synthesizeKokoroSamples(job.engineConfig, {
		text: job.text,
		sid: job.sid,
		speed: job.speed,
		silenceScale: job.silenceScale,
	})
	return { pcm: float32ToInt16Buffer(samples), sampleRate, channels: 1 }
}

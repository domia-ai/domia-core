import { mkdir } from "fs/promises"
import fs from "fs"
import path from "path"

import { DomiaType } from "@/modules/core"
import { generateUuid, ttsEngineLogger, TTS_ERRORS, domiaError } from "@/utils"
import {
	createOfflineTts,
	writeWave,
	type OfflineTtsInstance,
} from "@/utils/ml-runtime"
import { TTS_ENGINE_ENUM } from "@/db"
import type {
	RunTtsResultType,
	TtsEngineAdapterType,
	KokoroPathsType,
} from "../../types"

let tts: OfflineTtsInstance | null = null
let loadedDir: string | null = null

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

const validatePaths = (paths: KokoroPathsType) => {
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

const buildConfig = (paths: KokoroPathsType) => ({
	model: {
		kokoro: {
			model: paths.model,
			voices: paths.voices,
			tokens: paths.tokens,
			dataDir: paths.dataDir,
		},
		debug: false,
		numThreads: 2,
		provider: "cpu",
	},
	maxNumSentences: 1,
})

const getTts = (modelDir: string) => {
	const dir = path.resolve(modelDir)
	if (!tts || loadedDir !== dir) {
		const paths = resolvePaths(modelDir)
		validatePaths(paths)
		ttsEngineLogger.info("🚀 Loading Kokoro TTS", { modelDir: dir })
		tts = createOfflineTts(buildConfig(paths))
		loadedDir = dir
	}
	return tts
}

const KOKORO_VOICE_TO_SID: Record<string, number> = {
	af_heart: 0,
	af: 0,
	af_bella: 1,
	af_nicole: 4,
	af_sarah: 5,
	af_sky: 6,
	am_adam: 7,
	am_michael: 8,
	bf_emma: 9,
	bf_isabella: 10,
	bm_george: 11,
	bm_lewis: 12,
}

const resolveSid = (voiceName: string | null | undefined): number => {
	if (!voiceName) return 0
	if (voiceName in KOKORO_VOICE_TO_SID) return KOKORO_VOICE_TO_SID[voiceName]
	const asInt = Number(voiceName)
	if (Number.isInteger(asInt) && asInt >= 0) return asInt
	return 0
}

export const runKokoro = async (
	domia: DomiaType,
	text: string,
): Promise<RunTtsResultType> => {
	const ttsConfig = domia.ttsConfig
	const modelPath = ttsConfig?.modelPath
	const voiceName = ttsConfig?.voiceName ?? "af_heart"

	if (!ttsConfig || !modelPath) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				message: "Kokoro requires ttsConfig.modelPath (model directory)",
				modelPath,
			},
		})
	}

	const sid = resolveSid(voiceName)
	const outputDir = path.resolve("tmp/tts-output")
	await mkdir(outputDir, { recursive: true })
	const filePath = path.join(outputDir, `domia-${generateUuid()}.wav`)

	try {
		const engine = getTts(modelPath)
		const audio = engine.generate({
			text,
			generationConfig: { sid, speed: 1.0, silenceScale: 0.2 },
		})
		writeWave(filePath, {
			samples: audio.samples,
			sampleRate: audio.sampleRate,
		})
		return {
			engineUsed: TTS_ENGINE_ENUM.KOKORO,
			voiceUsed: voiceName,
			format: "wav",
			filePath,
			metadata: {
				text,
				lang: "en-US",
				sampleRate: audio.sampleRate,
				samples: audio.samples.length,
				sid,
			},
		}
	} catch (error) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				message: error instanceof Error ? error.message : String(error),
				voiceName,
				sid,
			},
		})
	}
}

const float32ToInt16Buffer = (samples: Float32Array): Buffer => {
	const out = Buffer.alloc(samples.length * 2)
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]))
		out.writeInt16LE(Math.round(clamped * 32767), i * 2)
	}
	return out
}

const runKokoroStream = async function* (
	domia: DomiaType,
	text: string,
): AsyncIterable<Buffer> {
	const ttsConfig = domia.ttsConfig
	const modelPath = ttsConfig?.modelPath
	const voiceName = ttsConfig?.voiceName ?? "af_heart"

	if (!ttsConfig || !modelPath) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				message: "Kokoro requires ttsConfig.modelPath (model directory)",
				modelPath,
			},
		})
	}

	const sid = resolveSid(voiceName)
	const engine = getTts(modelPath)
	const audio = engine.generate({
		text,
		generationConfig: { sid, speed: 1.0, silenceScale: 0.2 },
	})
	yield float32ToInt16Buffer(audio.samples)
}

export const kokoroEngine: TtsEngineAdapterType = {
	id: TTS_ENGINE_ENUM.KOKORO,
	capabilities: {
		streaming: true,
		sampleRate: 24000,
		sampleFormat: "PCM_S16LE",
		channels: 1,
		languages: ["en"],
	},
	run: runKokoro,
	runStream: runKokoroStream,
}

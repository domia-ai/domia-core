import fs from "fs"
import path from "path"

import { type DomiaType } from "@/modules/core"
import { STT_ENGINE_ENUM } from "@/db"
import {
	STT_ERRORS,
	sttEngineLogger,
	domiaError,
	findOnnxFile,
	resolveQuantization,
} from "@/utils"
import {
	createOfflineRecognizer,
	readWave,
	type OfflineRecognizerInstance,
} from "@/utils/ml-runtime"
import type { SttEngineAdapterType, MoonshinePathsType } from "../../types"

let recognizer: OfflineRecognizerInstance | null = null
let loadedKey: string | null = null

const resolvePaths = (
	modelDir: string,
	quantization: string | null | undefined,
): MoonshinePathsType | null => {
	const dir = path.resolve(modelDir)
	if (!fs.existsSync(dir)) return null
	const q = resolveQuantization(quantization)
	const preprocessor = findOnnxFile({
		dir,
		prefix: "preprocess",
		quantization: q,
	})
	const encoder = findOnnxFile({ dir, prefix: "encode", quantization: q })
	const cachedDecoder = findOnnxFile({
		dir,
		prefix: "cached_decode",
		quantization: q,
	})
	const uncachedDecoder = findOnnxFile({
		dir,
		prefix: "uncached_decode",
		quantization: q,
	})
	if (!preprocessor || !encoder || !cachedDecoder || !uncachedDecoder)
		return null
	return {
		dir,
		preprocessor,
		encoder,
		uncachedDecoder,
		cachedDecoder,
		tokens: path.join(dir, "tokens.txt"),
	}
}

const validatePaths = (
	paths: MoonshinePathsType | null,
	dir: string,
): MoonshinePathsType => {
	if (!paths || !fs.existsSync(paths.tokens)) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: `Moonshine model files missing at ${dir}. Run npm run setup:models:moonshine`,
				dir,
			},
		})
	}
	return paths
}

const buildConfig = (paths: MoonshinePathsType) => ({
	featConfig: { sampleRate: 16000, featureDim: 80 },
	modelConfig: {
		moonshine: {
			preprocessor: paths.preprocessor,
			encoder: paths.encoder,
			uncachedDecoder: paths.uncachedDecoder,
			cachedDecoder: paths.cachedDecoder,
		},
		tokens: paths.tokens,
		numThreads: 2,
		provider: "cpu",
		debug: 0,
	},
})

const getRecognizer = (
	modelDir: string,
	quantization: string | null | undefined,
) => {
	const dir = path.resolve(modelDir)
	const key = `${dir}|${quantization ?? "default"}`
	if (!recognizer || loadedKey !== key) {
		const paths = validatePaths(resolvePaths(modelDir, quantization), modelDir)
		sttEngineLogger.info(`🚀 Loading Moonshine recognizer`, {
			modelDir: dir,
			quantization: resolveQuantization(quantization),
		})
		recognizer = createOfflineRecognizer(buildConfig(paths))
		loadedKey = key
	}
	return recognizer
}

export const runMoonshine = async (domia: DomiaType, filePath: string) => {
	const sttConfig = domia?.sttConfig
	const modelPath = sttConfig?.modelPath

	if (!sttConfig || !modelPath) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: "Moonshine requires sttConfig.modelPath (model directory)",
				modelPath,
			},
		})
	}

	const rec = getRecognizer(modelPath, sttConfig.quantization)
	const wave = readWave(filePath)
	const stream = rec.createStream()
	stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
	rec.decode(stream)
	const result = rec.getResult(stream)
	return result.text.trim()
}

export const moonshineEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.MOONSHINE,
	capabilities: {
		streaming: false,
		expectedSampleRate: 16000,
	},
	run: runMoonshine,
}

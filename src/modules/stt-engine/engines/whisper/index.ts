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
import type { SttEngineAdapterType, WhisperPathsType } from "../../types"

let recognizer: OfflineRecognizerInstance | null = null
let loadedKey: string | null = null

const resolvePaths = (
	modelDir: string,
	modelName: string,
	quantization: string | null | undefined,
): WhisperPathsType | null => {
	const dir = path.resolve(modelDir)
	if (!fs.existsSync(dir)) return null
	const q = resolveQuantization(quantization)
	const encoder = findOnnxFile({
		dir,
		prefix: `${modelName}-encoder`,
		quantization: q,
	})
	const decoder = findOnnxFile({
		dir,
		prefix: `${modelName}-decoder`,
		quantization: q,
	})
	if (!encoder || !decoder) return null
	return {
		dir,
		encoder,
		decoder,
		tokens: path.join(dir, `${modelName}-tokens.txt`),
	}
}

const validatePaths = (
	paths: WhisperPathsType | null,
	dir: string,
): WhisperPathsType => {
	if (!paths || !fs.existsSync(paths.tokens)) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: `Whisper model files missing at ${dir}. Run npm run setup:models`,
				dir,
			},
		})
	}
	return paths
}

const buildConfig = (paths: WhisperPathsType) => ({
	featConfig: { sampleRate: 16000, featureDim: 80 },
	modelConfig: {
		whisper: { encoder: paths.encoder, decoder: paths.decoder },
		tokens: paths.tokens,
		numThreads: 2,
		provider: "cpu",
		debug: 0,
	},
})

const getRecognizer = (
	modelDir: string,
	modelName: string,
	quantization: string | null | undefined,
) => {
	const key = `${modelDir}|${modelName}|${quantization ?? "default"}`
	if (!recognizer || loadedKey !== key) {
		const paths = validatePaths(
			resolvePaths(modelDir, modelName, quantization),
			modelDir,
		)
		sttEngineLogger.info(`🚀 Loading Whisper recognizer`, {
			modelDir: paths.dir,
			modelName,
			quantization: resolveQuantization(quantization),
			encoder: paths.encoder,
		})
		recognizer = createOfflineRecognizer(buildConfig(paths))
		loadedKey = key
	}
	return recognizer
}

export const runWhisper = async (domia: DomiaType, filePath: string) => {
	const sttConfig = domia?.sttConfig
	const modelPath = sttConfig?.modelPath
	const modelName = sttConfig?.modelName

	if (!sttConfig || !modelPath || !modelName) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message:
					"Whisper requires sttConfig.modelPath (model directory) and sttConfig.modelName",
				modelPath,
				modelName,
			},
		})
	}

	const rec = getRecognizer(modelPath, modelName, sttConfig.quantization)
	const wave = readWave(filePath)
	const stream = rec.createStream()
	stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
	rec.decode(stream)
	const result = rec.getResult(stream)
	return result.text.trim()
}

export const whisperEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.WHISPER,
	capabilities: {
		streaming: false,
		expectedSampleRate: 16000,
	},
	run: runWhisper,
}

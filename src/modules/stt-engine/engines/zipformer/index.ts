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
	createOnlineRecognizer,
	readWave,
	type OnlineRecognizerInstance,
	type OnlineStream,
} from "@/utils/ml-runtime"
import type { SttEngineAdapterType, ZipformerPathsType } from "../../types"

const SAMPLE_RATE = 16000

let recognizer: OnlineRecognizerInstance | null = null
let loadedKey: string | null = null

const resolvePaths = (
	modelDir: string,
	quantization: string | null | undefined,
): ZipformerPathsType | null => {
	const dir = path.resolve(modelDir)
	if (!fs.existsSync(dir)) return null
	const q = resolveQuantization(quantization)
	const encoder = findOnnxFile({ dir, prefix: "encoder", quantization: q })
	const decoder = findOnnxFile({ dir, prefix: "decoder", quantization: q })
	const joiner = findOnnxFile({ dir, prefix: "joiner", quantization: q })
	if (!encoder || !decoder || !joiner) return null
	return {
		dir,
		encoder,
		decoder,
		joiner,
		tokens: path.join(dir, "tokens.txt"),
	}
}

const validatePaths = (
	paths: ZipformerPathsType | null,
	dir: string,
): ZipformerPathsType => {
	if (!paths || !fs.existsSync(paths.tokens)) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: `Zipformer model files missing at ${dir}. Run npm run setup:models:zipformer`,
				dir,
			},
		})
	}
	return paths
}

const buildConfig = (paths: ZipformerPathsType) => ({
	featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
	modelConfig: {
		transducer: {
			encoder: paths.encoder,
			decoder: paths.decoder,
			joiner: paths.joiner,
		},
		tokens: paths.tokens,
		numThreads: 2,
		provider: "cpu",
		debug: 0,
	},
	enableEndpoint: true,
	rule1MinTrailingSilence: 2.4,
	rule2MinTrailingSilence: 1.2,
	rule3MinUtteranceLength: 20,
})

const getRecognizer = (
	modelDir: string,
	quantization: string | null | undefined,
) => {
	const dir = path.resolve(modelDir)
	const key = `${dir}|${quantization ?? "default"}`
	if (!recognizer || loadedKey !== key) {
		const paths = validatePaths(resolvePaths(modelDir, quantization), modelDir)
		sttEngineLogger.info(`🚀 Loading Zipformer recognizer`, {
			modelDir: dir,
			quantization: resolveQuantization(quantization),
		})
		recognizer = createOnlineRecognizer(buildConfig(paths))
		loadedKey = key
	}
	return recognizer
}

const resolveRecognizer = (domia: DomiaType): OnlineRecognizerInstance => {
	const sttConfig = domia?.sttConfig
	const modelPath = sttConfig?.modelPath

	if (!sttConfig || !modelPath) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: "Zipformer STT requires sttConfig.modelPath (model directory)",
				modelPath,
			},
		})
	}

	return getRecognizer(modelPath, sttConfig.quantization)
}

const int16BufferToFloat32 = (chunk: Buffer): Float32Array => {
	const usable = chunk.length - (chunk.length % 2)
	const out = new Float32Array(usable / 2)
	for (let i = 0; i < out.length; i++) {
		out[i] = chunk.readInt16LE(i * 2) / 32768
	}
	return out
}

const drain = (rec: OnlineRecognizerInstance, stream: OnlineStream) => {
	while (rec.isReady(stream)) rec.decode(stream)
}

const runZipformer = async (
	domia: DomiaType,
	filePath: string,
): Promise<string> => {
	const rec = resolveRecognizer(domia)
	const wave = readWave(filePath)
	const stream = rec.createStream()
	stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
	stream.inputFinished()
	drain(rec, stream)
	return rec.getResult(stream).text.trim()
}

const runZipformerStream = async (
	domia: DomiaType,
	audioStream: AsyncIterable<Buffer>,
): Promise<string> => {
	const rec = resolveRecognizer(domia)
	const stream = rec.createStream()
	const segments: string[] = []

	for await (const chunk of audioStream) {
		const samples = int16BufferToFloat32(chunk)
		if (samples.length === 0) continue
		stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
		drain(rec, stream)
		if (rec.isEndpoint(stream)) {
			const segment = rec.getResult(stream).text.trim()
			if (segment) segments.push(segment)
			rec.reset(stream)
		}
	}

	stream.inputFinished()
	drain(rec, stream)
	const tail = rec.getResult(stream).text.trim()
	if (tail) segments.push(tail)

	return segments.join(" ").trim()
}

export const zipformerEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.ZIPFORMER,
	capabilities: {
		streaming: true,
		expectedSampleRate: SAMPLE_RATE,
	},
	run: runZipformer,
	runStream: runZipformerStream,
}

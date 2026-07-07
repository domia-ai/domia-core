import type { RecognizerEntryType, OnlineEntryType } from "../types"
import fs from "fs"
import path from "path"

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
	createOfflineRecognizer,
	readWave,
} from "@/utils/ml-runtime"
import type {
	SttWorkerEngineConfigType,
	SttWorkerJobType,
	SttWorkerResultType,
	SttSessionJobType,
	SttSessionResultType,
} from "../types"

const SAMPLE_RATE = 16000
const FEAT = { sampleRate: SAMPLE_RATE, featureDim: 80 }
const FEAT_128 = { sampleRate: SAMPLE_RATE, featureDim: 128 }

let cached: RecognizerEntryType | null = null
let cachedKey: string | null = null

const missing = (dir: string): never => {
	throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
		logger: sttEngineLogger,
		meta: { message: `STT model files missing at ${dir}`, dir },
	})
}

const buildZipformer = (config: SttWorkerEngineConfigType) => {
	const dir = path.resolve(config.modelPath)
	if (!fs.existsSync(dir)) missing(dir)
	const q = resolveQuantization(config.quantization)
	const encoder = findOnnxFile({ dir, prefix: "encoder", quantization: q })
	const decoder = findOnnxFile({ dir, prefix: "decoder", quantization: q })
	const joiner = findOnnxFile({ dir, prefix: "joiner", quantization: q })
	const tokens = path.join(dir, "tokens.txt")
	if (!encoder || !decoder || !joiner || !fs.existsSync(tokens)) missing(dir)
	return createOnlineRecognizer({
		featConfig: FEAT,
		modelConfig: {
			transducer: { encoder, decoder, joiner },
			tokens,
			numThreads: config.numThreads,
			provider: config.provider,
			debug: 0,
		},
		enableEndpoint: config.enableEndpoint,
		rule1MinTrailingSilence: config.rule1MinTrailingSilence,
		rule2MinTrailingSilence: config.rule2MinTrailingSilence,
		rule3MinUtteranceLength: config.rule3MinUtteranceLength,
	})
}

const buildParakeetStreaming = (config: SttWorkerEngineConfigType) => {
	const dir = path.resolve(config.modelPath)
	if (!fs.existsSync(dir)) missing(dir)
	const q = resolveQuantization(config.quantization)
	const encoder = findOnnxFile({ dir, prefix: "encoder", quantization: q })
	const decoder = findOnnxFile({ dir, prefix: "decoder", quantization: q })
	const joiner = findOnnxFile({ dir, prefix: "joiner", quantization: q })
	const tokens = path.join(dir, "tokens.txt")
	if (!encoder || !decoder || !joiner || !fs.existsSync(tokens)) missing(dir)
	return createOnlineRecognizer({
		featConfig: FEAT_128,
		modelConfig: {
			transducer: { encoder, decoder, joiner },
			tokens,
			numThreads: config.numThreads,
			provider: config.provider,
			debug: 0,
		},
		enableEndpoint: config.enableEndpoint,
		rule1MinTrailingSilence: config.rule1MinTrailingSilence,
		rule2MinTrailingSilence: config.rule2MinTrailingSilence,
		rule3MinUtteranceLength: config.rule3MinUtteranceLength,
	})
}

const buildWhisper = (config: SttWorkerEngineConfigType) => {
	const dir = path.resolve(config.modelPath)
	const name = config.modelName ?? ""
	if (!fs.existsSync(dir)) missing(dir)
	const q = resolveQuantization(config.quantization)
	const encoder = findOnnxFile({
		dir,
		prefix: `${name}-encoder`,
		quantization: q,
	})
	const decoder = findOnnxFile({
		dir,
		prefix: `${name}-decoder`,
		quantization: q,
	})
	const tokens = path.join(dir, `${name}-tokens.txt`)
	if (!encoder || !decoder || !fs.existsSync(tokens)) missing(dir)
	const englishOnly = name.endsWith(".en")
	const whisper =
		!englishOnly && config.language
			? { encoder, decoder, language: config.language, task: "transcribe" }
			: { encoder, decoder }
	return createOfflineRecognizer({
		featConfig: FEAT,
		modelConfig: {
			whisper,
			tokens,
			numThreads: config.numThreads,
			provider: config.provider,
			debug: 0,
		},
	})
}

const buildMoonshine = (config: SttWorkerEngineConfigType) => {
	const dir = path.resolve(config.modelPath)
	if (!fs.existsSync(dir)) missing(dir)
	const q = resolveQuantization(config.quantization)
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
	const tokens = path.join(dir, "tokens.txt")
	if (
		!preprocessor ||
		!encoder ||
		!cachedDecoder ||
		!uncachedDecoder ||
		!fs.existsSync(tokens)
	)
		missing(dir)
	return createOfflineRecognizer({
		featConfig: FEAT,
		modelConfig: {
			moonshine: { preprocessor, encoder, uncachedDecoder, cachedDecoder },
			tokens,
			numThreads: config.numThreads,
			provider: config.provider,
			debug: 0,
		},
	})
}

const buildParakeet = (config: SttWorkerEngineConfigType) => {
	const dir = path.resolve(config.modelPath)
	if (!fs.existsSync(dir)) missing(dir)
	const q = resolveQuantization(config.quantization)
	const encoder = findOnnxFile({ dir, prefix: "encoder", quantization: q })
	const decoder = findOnnxFile({ dir, prefix: "decoder", quantization: q })
	const joiner = findOnnxFile({ dir, prefix: "joiner", quantization: q })
	const tokens = path.join(dir, "tokens.txt")
	if (!encoder || !decoder || !joiner || !fs.existsSync(tokens)) missing(dir)
	return createOfflineRecognizer({
		featConfig: FEAT,
		modelConfig: {
			transducer: { encoder, decoder, joiner },
			tokens,
			modelType: "nemo_transducer",
			numThreads: config.numThreads,
			provider: config.provider,
			debug: 0,
		},
	})
}

const configKey = (config: SttWorkerEngineConfigType): string =>
	[
		config.engine,
		path.resolve(config.modelPath),
		config.modelName ?? "",
		config.quantization ?? "default",
		config.numThreads,
		config.provider,
		config.enableEndpoint,
		config.rule1MinTrailingSilence,
		config.rule2MinTrailingSilence,
		config.rule3MinUtteranceLength,
	].join("|")

const getRecognizer = (
	config: SttWorkerEngineConfigType,
): RecognizerEntryType => {
	const key = configKey(config)
	if (cached && cachedKey === key) return cached
	sttEngineLogger.info("🚀 Loading STT recognizer", {
		engine: config.engine,
		modelDir: path.resolve(config.modelPath),
		pid: process.pid,
	})
	if (config.engine === STT_ENGINE_ENUM.ZIPFORMER) {
		cached = { online: true, rec: buildZipformer(config) }
	} else if (config.engine === STT_ENGINE_ENUM.PARAKEET_STREAMING) {
		cached = { online: true, rec: buildParakeetStreaming(config) }
	} else if (config.engine === STT_ENGINE_ENUM.WHISPER) {
		cached = { online: false, rec: buildWhisper(config) }
	} else if (config.engine === STT_ENGINE_ENUM.PARAKEET) {
		cached = { online: false, rec: buildParakeet(config) }
	} else {
		cached = { online: false, rec: buildMoonshine(config) }
	}
	cachedKey = key
	return cached
}

const int16BufferToFloat32 = (chunk: Buffer): Float32Array => {
	const usable = chunk.length - (chunk.length % 2)
	const out = new Float32Array(usable / 2)
	for (let i = 0; i < out.length; i++) out[i] = chunk.readInt16LE(i * 2) / 32768
	return out
}

const transcribe = (
	entry: RecognizerEntryType,
	samples: Float32Array,
	sampleRate: number,
	decodePaddingMs: number,
): string => {
	if (entry.online) {
		const rec = entry.rec
		const stream = rec.createStream()
		stream.acceptWaveform({ sampleRate, samples })
		const padSamples = Math.round((sampleRate * decodePaddingMs) / 1000)
		if (padSamples > 0) {
			stream.acceptWaveform({
				sampleRate,
				samples: new Float32Array(padSamples),
			})
		}
		stream.inputFinished()
		while (rec.isReady(stream)) rec.decode(stream)
		return rec.getResult(stream).text.trim()
	}
	const rec = entry.rec
	const stream = rec.createStream()
	stream.acceptWaveform({ sampleRate, samples })
	rec.decode(stream)
	return rec.getResult(stream).text.trim()
}

let activeSession: {
	stream: ReturnType<OnlineEntryType["rec"]["createStream"]>
	entry: OnlineEntryType
} | null = null

const decodePending = (): void => {
	if (!activeSession) return
	const rec = activeSession.entry.rec
	while (rec.isReady(activeSession.stream)) rec.decode(activeSession.stream)
}

export const handleSttSessionJob = (
	job: SttSessionJobType,
): SttSessionResultType => {
	if (job.kind === "session-start") {
		const entry = getRecognizer(job.engineConfig)
		if (!entry.online) {
			throw new Error("STT sessions require a streaming (online) engine")
		}
		activeSession = { stream: entry.rec.createStream(), entry }
		return { ok: true }
	}
	if (!activeSession) throw new Error("no active STT session")
	const { stream, entry } = activeSession
	if (job.kind === "session-chunk") {
		stream.acceptWaveform({
			sampleRate: job.sampleRate,
			samples: int16BufferToFloat32(Buffer.from(job.pcm)),
		})
		decodePending()
		return { partial: entry.rec.getResult(stream).text.trim() }
	}
	if (job.kind === "session-end") {
		const padSamples = Math.round((job.sampleRate * job.decodePaddingMs) / 1000)
		if (padSamples > 0) {
			stream.acceptWaveform({
				sampleRate: job.sampleRate,
				samples: new Float32Array(padSamples),
			})
		}
		stream.inputFinished()
		decodePending()
		const text = entry.rec.getResult(stream).text.trim()
		activeSession = null
		return { text }
	}
	activeSession = null
	return { ok: true }
}

export const transcribeSttJob = (
	job: SttWorkerJobType,
): SttWorkerResultType => {
	const entry = getRecognizer(job.engineConfig)
	const pad = job.engineConfig.decodePaddingMs
	if (job.kind === "file") {
		const wave = readWave(job.wavPath)
		return { text: transcribe(entry, wave.samples, wave.sampleRate, pad) }
	}
	const samples = int16BufferToFloat32(job.pcm)
	return { text: transcribe(entry, samples, job.sampleRate, pad) }
}

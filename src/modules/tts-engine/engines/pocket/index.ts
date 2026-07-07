import { mkdir, writeFile } from "fs/promises"
import path from "path"

import { DomiaType } from "@/modules/core"
import {
	generateUuid,
	ttsEngineLogger,
	TTS_ERRORS,
	domiaError,
	wrapPcmToWav,
	applyEdgeFade,
} from "@/utils"
import {
	createOfflineTts,
	readWave,
	type OfflineTtsInstance,
	type Waveform,
} from "@/utils/ml-runtime"
import {
	type SelectTtsConfigType,
	TTS_ENGINE_ENUM,
	DEFAULT_POCKET_MODEL_PATH,
	DEFAULT_POCKET_NUM_STEPS,
	DEFAULT_POCKET_REFERENCE_WAV,
	DEFAULT_POCKET_VOICE_CACHE,
} from "@/db"
import { splitTextIntoSentences } from "@/modules/core-bus/utils/sentence-buffer"

import { resolveTtsVoice } from "../../utils"
import type {
	RunTtsOptionsType,
	RunTtsResultType,
	TtsEngineAdapterType,
} from "../../types"

const POCKET_SAMPLE_RATE = 24000

let cachedEngine: OfflineTtsInstance | null = null
let cachedEngineKey: string | null = null
let cachedReference: Waveform | null = null
let cachedReferencePath: string | null = null

const floatToPcm16 = (samples: Float32Array): Buffer => {
	const buf = Buffer.alloc(samples.length * 2)
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]))
		buf.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, i * 2)
	}
	return buf
}

const modelDirOf = (ttsConfig: SelectTtsConfigType): string =>
	path.resolve(ttsConfig.modelPath || DEFAULT_POCKET_MODEL_PATH)

const getEngine = (ttsConfig: SelectTtsConfigType): OfflineTtsInstance => {
	const dir = modelDirOf(ttsConfig)
	const capacity =
		ttsConfig.engineConfig?.voiceEmbeddingCacheCapacity ??
		DEFAULT_POCKET_VOICE_CACHE
	const key = `${dir}|${ttsConfig.numThreads}|${ttsConfig.provider}|${capacity}`
	if (cachedEngine && cachedEngineKey === key) return cachedEngine
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
				voiceEmbeddingCacheCapacity: capacity,
			},
			debug: false,
			numThreads: ttsConfig.numThreads,
			provider: ttsConfig.provider,
		},
		maxNumSentences: ttsConfig.maxNumSentences,
	})
	cachedEngineKey = key
	return cachedEngine
}

const getReference = (ttsConfig: SelectTtsConfigType): Waveform => {
	const configured = ttsConfig.engineConfig?.referenceAudioPath?.trim()
	const refPath = configured
		? path.resolve(configured)
		: path.join(modelDirOf(ttsConfig), DEFAULT_POCKET_REFERENCE_WAV)
	if (cachedReference && cachedReferencePath === refPath) return cachedReference
	cachedReference = readWave(refPath)
	cachedReferencePath = refPath
	return cachedReference
}

const generateSentence = (
	ttsConfig: SelectTtsConfigType,
	text: string,
	speed: number,
): Buffer => {
	const engine = getEngine(ttsConfig)
	const reference = getReference(ttsConfig)
	const audio = engine.generate({
		text,
		generationConfig: {
			speed,
			referenceAudio: reference.samples,
			referenceSampleRate: reference.sampleRate,
			numSteps: ttsConfig.engineConfig?.numSteps ?? DEFAULT_POCKET_NUM_STEPS,
		},
	})
	return floatToPcm16(audio.samples)
}

const runPocket = async (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): Promise<RunTtsResultType> => {
	const ttsConfig = domia.ttsConfig
	if (!ttsConfig)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "Pocket requires a ttsConfig" },
		})
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	try {
		const parts: Buffer[] = []
		for (const sentence of splitTextIntoSentences(text)) {
			const pcm = generateSentence(ttsConfig, sentence, voice.speed)
			if (pcm.length > 0) parts.push(applyEdgeFade(pcm, POCKET_SAMPLE_RATE))
		}
		const pcm = Buffer.concat(parts)
		const outputDir = path.resolve("tmp/tts-output")
		await mkdir(outputDir, { recursive: true })
		const filePath = path.join(outputDir, `domia-${generateUuid()}.wav`)
		await writeFile(filePath, wrapPcmToWav(pcm, POCKET_SAMPLE_RATE, 1, 16))
		return {
			engineUsed: TTS_ENGINE_ENUM.POCKET,
			voiceUsed: voice.voiceName,
			format: "wav",
			filePath,
			metadata: {
				text,
				sampleRate: POCKET_SAMPLE_RATE,
				samples: pcm.length / 2,
			},
		}
	} catch (error) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				message: error instanceof Error ? error.message : String(error),
				engine: TTS_ENGINE_ENUM.POCKET,
			},
		})
	}
}

const runPocketStream = async function* (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const ttsConfig = domia.ttsConfig
	if (!ttsConfig)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "Pocket requires a ttsConfig" },
		})
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	for (const sentence of splitTextIntoSentences(text)) {
		const pcm = generateSentence(ttsConfig, sentence, voice.speed)
		if (pcm.length > 0) yield applyEdgeFade(pcm, POCKET_SAMPLE_RATE)
	}
}

export const pocketEngine: TtsEngineAdapterType = {
	id: TTS_ENGINE_ENUM.POCKET,
	capabilities: {
		streaming: true,
		sampleRate: POCKET_SAMPLE_RATE,
		sampleFormat: "PCM_S16LE",
		channels: 1,
		languages: ["en"],
	},
	run: runPocket,
	runStream: runPocketStream,
}

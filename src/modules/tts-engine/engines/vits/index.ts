import { readdirSync } from "fs"
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
import { createOfflineTts, type OfflineTtsInstance } from "@/utils/ml-runtime"
import { type SelectTtsConfigType, TTS_ENGINE_ENUM } from "@/db"
import { splitTextIntoSentences } from "@/modules/core-bus/utils/sentence-buffer"

import { resolveTtsVoice } from "../../utils"
import type {
	RunTtsOptionsType,
	RunTtsResultType,
	TtsEngineAdapterType,
} from "../../types"

let cachedEngine: OfflineTtsInstance | null = null
let cachedKey: string | null = null

const floatToPcm16 = (samples: Float32Array): Buffer => {
	const buf = Buffer.alloc(samples.length * 2)
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]))
		buf.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, i * 2)
	}
	return buf
}

const findModelFile = (dir: string): string | null => {
	const files = readdirSync(dir).filter(
		(f) => f.endsWith(".onnx") && !f.includes("vocoder"),
	)
	return files.length > 0 ? path.join(dir, files[0]) : null
}

const getEngine = (ttsConfig: SelectTtsConfigType): OfflineTtsInstance => {
	const dir = path.resolve(ttsConfig.modelPath)
	const model = findModelFile(dir)
	if (!model)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "VITS model .onnx not found", dir },
		})
	const key = `${dir}|${ttsConfig.numThreads}|${ttsConfig.provider}`
	if (cachedEngine && cachedKey === key) return cachedEngine
	cachedEngine = createOfflineTts({
		model: {
			vits: {
				model,
				tokens: path.join(dir, "tokens.txt"),
				dataDir: ttsConfig.espeakNgDataPath?.trim()
					? path.resolve(ttsConfig.espeakNgDataPath)
					: path.join(dir, "espeak-ng-data"),
			},
			debug: false,
			numThreads: ttsConfig.numThreads,
			provider: ttsConfig.provider,
		},
		maxNumSentences: ttsConfig.maxNumSentences,
	})
	cachedKey = key
	return cachedEngine
}

const sidOf = (voiceName: string): number => {
	const parsed = Number.parseInt(voiceName, 10)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const generateSentence = (
	ttsConfig: SelectTtsConfigType,
	text: string,
	sid: number,
	speed: number,
): { pcm: Buffer; sampleRate: number } => {
	const engine = getEngine(ttsConfig)
	const audio = engine.generate({
		text,
		generationConfig: { sid, speed },
	})
	return { pcm: floatToPcm16(audio.samples), sampleRate: audio.sampleRate }
}

const runVits = async (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): Promise<RunTtsResultType> => {
	const ttsConfig = domia.ttsConfig
	if (!ttsConfig?.modelPath)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "VITS requires ttsConfig.modelPath (model dir)" },
		})
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	const sid = sidOf(voice.voiceName)
	try {
		const parts: Buffer[] = []
		let sampleRate = 22050
		for (const sentence of splitTextIntoSentences(text)) {
			const result = generateSentence(ttsConfig, sentence, sid, voice.speed)
			if (result.pcm.length > 0) {
				parts.push(applyEdgeFade(result.pcm, result.sampleRate))
				sampleRate = result.sampleRate
			}
		}
		const pcm = Buffer.concat(parts)
		const outputDir = path.resolve("tmp/tts-output")
		await mkdir(outputDir, { recursive: true })
		const filePath = path.join(outputDir, `domia-${generateUuid()}.wav`)
		await writeFile(filePath, wrapPcmToWav(pcm, sampleRate, 1, 16))
		return {
			engineUsed: TTS_ENGINE_ENUM.VITS,
			voiceUsed: voice.voiceName,
			format: "wav",
			filePath,
			metadata: { text, sampleRate, samples: pcm.length / 2, sid },
		}
	} catch (error) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				message: error instanceof Error ? error.message : String(error),
				engine: TTS_ENGINE_ENUM.VITS,
			},
		})
	}
}

const runVitsStream = async function* (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const ttsConfig = domia.ttsConfig
	if (!ttsConfig?.modelPath)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "VITS requires ttsConfig.modelPath (model dir)" },
		})
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	const sid = sidOf(voice.voiceName)
	for (const sentence of splitTextIntoSentences(text)) {
		const result = generateSentence(ttsConfig, sentence, sid, voice.speed)
		if (result.pcm.length > 0)
			yield applyEdgeFade(result.pcm, result.sampleRate)
	}
}

export const vitsEngine: TtsEngineAdapterType = {
	id: TTS_ENGINE_ENUM.VITS,
	capabilities: {
		streaming: true,
		sampleRate: 22050,
		sampleFormat: "PCM_S16LE",
		channels: 1,
		languages: ["multi"],
	},
	run: runVits,
	runStream: runVitsStream,
}

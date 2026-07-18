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
import { type SelectTtsConfigType, TTS_ENGINE_ENUM } from "@/db"
import { splitTextIntoSentences } from "@/modules/core-bus/utils/sentence-buffer"

import { resolveTtsVoice, getTtsPool } from "../../utils"
import type {
	RunTtsOptionsType,
	RunTtsResultType,
	TtsEngineAdapterType,
	TtsWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

const DEFAULT_LENGTH_SCALE = 1.0

const requireTtsConfig = (domia: DomiaType): SelectTtsConfigType => {
	const ttsConfig = domia.ttsConfig
	if (!ttsConfig?.modelPath)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "Kitten requires ttsConfig.modelPath (model dir)" },
		})
	return ttsConfig
}

const sidOf = (voiceName: string): number => {
	const parsed = Number.parseInt(voiceName, 10)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const jobOf = (
	ttsConfig: SelectTtsConfigType,
	text: string,
	sid: number,
	speed: number,
): TtsWorkerJobType => ({
	engine: TTS_ENGINE_ENUM.KITTEN,
	engineConfig: {
		modelPath: path.resolve(ttsConfig.modelPath),
		numThreads: ttsConfig.numThreads,
		provider: ttsConfig.provider,
		maxNumSentences: ttsConfig.maxNumSentences,
		espeakDataDir: ttsConfig.espeakNgDataPath ?? null,
		lengthScale: ttsConfig.engineConfig?.lengthScale ?? DEFAULT_LENGTH_SCALE,
	},
	text,
	sid,
	speed,
})

const runKitten = async (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): Promise<RunTtsResultType> => {
	const ttsConfig = requireTtsConfig(domia)
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	const sid = sidOf(voice.voiceName)
	try {
		const pool = getTtsPool(ttsConfig)
		const parts: Buffer[] = []
		let sampleRate = kittenEngine.capabilities.sampleRate
		for (const sentence of splitTextIntoSentences(text)) {
			const result = await pool.submit<TtsWorkerResultType>(
				jobOf(ttsConfig, sentence, sid, voice.speed),
			)
			if (result.pcm && result.pcm.length > 0) {
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
			engineUsed: TTS_ENGINE_ENUM.KITTEN,
			voiceUsed: voice.voiceName,
			format: "wav",
			filePath,
			metadata: { text, sampleRate, samples: pcm.length / 2, sid },
		}
	} catch (error) {
		throw domiaError(TTS_ERRORS.TTS_FAILURE, {
			logger: ttsEngineLogger,
			meta: {
				message: error instanceof Error ? error.message : String(error),
				engine: TTS_ENGINE_ENUM.KITTEN,
			},
		})
	}
}

const runKittenStream = async function* (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const ttsConfig = requireTtsConfig(domia)
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	const sid = sidOf(voice.voiceName)
	const pool = getTtsPool(ttsConfig)
	for (const sentence of splitTextIntoSentences(text)) {
		const result = await pool.submit<TtsWorkerResultType>(
			jobOf(ttsConfig, sentence, sid, voice.speed),
		)
		if (result.pcm && result.pcm.length > 0)
			yield applyEdgeFade(result.pcm, result.sampleRate)
	}
}

export const kittenEngine: TtsEngineAdapterType = {
	id: TTS_ENGINE_ENUM.KITTEN,
	capabilities: {
		streaming: true,
		sampleRate: 24000,
		sampleFormat: "PCM_S16LE",
		channels: 1,
		languages: ["en"],
	},
	run: runKitten,
	runStream: runKittenStream,
}

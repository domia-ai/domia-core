import { mkdir, writeFile } from "fs/promises"
import path from "path"

import { DomiaType } from "@/modules/core"
import {
	generateUuid,
	ttsEngineLogger,
	TTS_ERRORS,
	domiaError,
	wrapPcmToWav,
} from "@/utils"
import { type SelectTtsConfigType, TTS_ENGINE_ENUM } from "@/db"
import { splitTextIntoSentences } from "@/modules/core-bus/utils/sentence-buffer"
import { getTtsPool } from "../../utils"
import type {
	RunTtsResultType,
	TtsEngineAdapterType,
	TtsWorkerEngineConfigType,
	TtsWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

const KOKORO_SAMPLE_RATE = 24000

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

const requireTtsConfig = (domia: DomiaType): SelectTtsConfigType => {
	const ttsConfig = domia.ttsConfig
	if (!ttsConfig || !ttsConfig.modelPath) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				message: "Kokoro requires ttsConfig.modelPath (model directory)",
				modelPath: ttsConfig?.modelPath,
			},
		})
	}
	return ttsConfig
}

const engineConfigOf = (
	ttsConfig: SelectTtsConfigType,
): TtsWorkerEngineConfigType => ({
	modelPath: path.resolve(ttsConfig.modelPath),
	numThreads: ttsConfig.numThreads,
	provider: ttsConfig.provider,
	maxNumSentences: ttsConfig.maxNumSentences,
})

const jobOf = (
	ttsConfig: SelectTtsConfigType,
	text: string,
): TtsWorkerJobType => ({
	engineConfig: engineConfigOf(ttsConfig),
	text,
	sid: resolveSid(ttsConfig.voiceName),
	speed: ttsConfig.speed,
	silenceScale: ttsConfig.silenceScale,
})

export const runKokoro = async (
	domia: DomiaType,
	text: string,
): Promise<RunTtsResultType> => {
	const ttsConfig = requireTtsConfig(domia)
	const voiceName = ttsConfig.voiceName
	const sid = resolveSid(voiceName)
	const outputDir = path.resolve("tmp/tts-output")
	await mkdir(outputDir, { recursive: true })
	const filePath = path.join(outputDir, `domia-${generateUuid()}.wav`)

	try {
		const pool = getTtsPool(ttsConfig)
		const parts: Buffer[] = []
		let sampleRate = KOKORO_SAMPLE_RATE
		for (const sentence of splitTextIntoSentences(text)) {
			const result = await pool.submit<TtsWorkerResultType>(
				jobOf(ttsConfig, sentence),
			)
			if (result.pcm && result.pcm.length > 0) {
				parts.push(result.pcm)
				sampleRate = result.sampleRate
			}
		}
		const pcm = Buffer.concat(parts)
		await writeFile(filePath, wrapPcmToWav(pcm, sampleRate, 1, 16))
		return {
			engineUsed: TTS_ENGINE_ENUM.KOKORO,
			voiceUsed: voiceName,
			format: "wav",
			filePath,
			metadata: {
				text,
				lang: ttsConfig.language,
				sampleRate,
				samples: pcm.length / 2,
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

const runKokoroStream = async function* (
	domia: DomiaType,
	text: string,
): AsyncIterable<Buffer> {
	const ttsConfig = requireTtsConfig(domia)
	const pool = getTtsPool(ttsConfig)
	for (const sentence of splitTextIntoSentences(text)) {
		const result = await pool.submit<TtsWorkerResultType>(
			jobOf(ttsConfig, sentence),
		)
		if (result.pcm && result.pcm.length > 0) yield result.pcm
	}
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

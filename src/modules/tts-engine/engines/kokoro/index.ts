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
import { getTtsPool, resolveTtsVoice } from "../../utils"
import type {
	RunTtsOptionsType,
	RunTtsResultType,
	TtsEngineAdapterType,
	TtsVoiceType,
	TtsWorkerEngineConfigType,
	TtsWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

const KOKORO_SAMPLE_RATE = 24000

const KOKORO_VOICE_TO_SID: Record<string, number> = {
	af_alloy: 0,
	af_aoede: 1,
	af_bella: 2,
	af_heart: 3,
	af: 3,
	af_jessica: 4,
	af_kore: 5,
	af_nicole: 6,
	af_nova: 7,
	af_river: 8,
	af_sarah: 9,
	af_sky: 10,
	am_adam: 11,
	am_echo: 12,
	am_eric: 13,
	am_fenrir: 14,
	am_liam: 15,
	am_michael: 16,
	am_onyx: 17,
	am_puck: 18,
	am_santa: 19,
	bf_alice: 20,
	bf_emma: 21,
	bf_isabella: 22,
	bf_lily: 23,
	bm_daniel: 24,
	bm_fable: 25,
	bm_george: 26,
	bm_lewis: 27,
	ef_dora: 28,
	em_alex: 29,
	ff_siwis: 30,
	hf_alpha: 31,
	hf_beta: 32,
	hm_omega: 33,
	hm_psi: 34,
	if_sara: 35,
	im_nicola: 36,
	jf_alpha: 37,
	jf_gongitsune: 38,
	jf_nezumi: 39,
	jf_tebukuro: 40,
	jm_kumo: 41,
	pf_dora: 42,
	pm_alex: 43,
	pm_santa: 44,
	zf_xiaobei: 45,
	zf_xiaoni: 46,
	zf_xiaoxiao: 47,
	zf_xiaoyi: 48,
	zm_yunjian: 49,
	zm_yunxi: 50,
	zm_yunxia: 51,
	zm_yunyang: 52,
}

const resolveSid = (voiceName: string | null | undefined): number => {
	if (!voiceName) return 0
	if (voiceName in KOKORO_VOICE_TO_SID) return KOKORO_VOICE_TO_SID[voiceName]
	const asInt = Number(voiceName)
	if (Number.isInteger(asInt) && asInt >= 0) return asInt
	ttsEngineLogger.warn(
		`⚠️ unknown Kokoro voice "${voiceName}" — falling back to default voice (sid 0)`,
		{ voiceName },
	)
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
	espeakDataDir: ttsConfig.espeakNgDataPath ?? null,
})

const jobOf = (
	ttsConfig: SelectTtsConfigType,
	text: string,
	voice: TtsVoiceType,
	sid: number,
): TtsWorkerJobType => ({
	engineConfig: engineConfigOf(ttsConfig),
	text,
	sid,
	speed: voice.speed,
	silenceScale: voice.silenceScale,
})

export const runKokoro = async (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): Promise<RunTtsResultType> => {
	const ttsConfig = requireTtsConfig(domia)
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	const voiceName = voice.voiceName
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
				jobOf(ttsConfig, sentence, voice, sid),
			)
			if (result.pcm && result.pcm.length > 0) {
				parts.push(applyEdgeFade(result.pcm, result.sampleRate))
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
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const ttsConfig = requireTtsConfig(domia)
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	const sid = resolveSid(voice.voiceName)
	const pool = getTtsPool(ttsConfig)
	for (const sentence of splitTextIntoSentences(text)) {
		const result = await pool.submit<TtsWorkerResultType>(
			jobOf(ttsConfig, sentence, voice, sid),
		)
		if (result.pcm && result.pcm.length > 0)
			yield applyEdgeFade(result.pcm, kokoroEngine.capabilities.sampleRate)
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

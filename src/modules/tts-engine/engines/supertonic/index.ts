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
	type SelectTtsConfigType,
	TTS_ENGINE_ENUM,
	DEFAULT_SUPERTONIC_MODEL_PATH,
	DEFAULT_SUPERTONIC_NUM_STEPS,
} from "@/db"
import { splitTextIntoSentences } from "@/modules/core-bus/utils/sentence-buffer"

import { resolveTtsVoice, getTtsPool } from "../../utils"
import { SUPERTONIC_SAMPLE_RATE } from "./inference"
import type {
	RunTtsOptionsType,
	RunTtsResultType,
	TtsEngineAdapterType,
	SupertonicWorkerJobType,
	TtsWorkerResultType,
} from "../../types"

const requireTtsConfig = (domia: DomiaType): SelectTtsConfigType => {
	const ttsConfig = domia.ttsConfig
	if (!ttsConfig)
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: { message: "Supertonic requires a ttsConfig" },
		})
	return ttsConfig
}

const sidOf = (voiceName: string | null | undefined): number => {
	const parsed = Number.parseInt(voiceName?.trim() ?? "", 10)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const langOf = (ttsConfig: SelectTtsConfigType): string =>
	ttsConfig.language.toLowerCase().replace(/[-_].*$/, "")

const jobOf = (
	ttsConfig: SelectTtsConfigType,
	text: string,
	voiceName: string,
	speed: number,
): SupertonicWorkerJobType => ({
	engine: TTS_ENGINE_ENUM.SUPERTONIC,
	engineConfig: {
		modelPath: path.resolve(
			ttsConfig.modelPath || DEFAULT_SUPERTONIC_MODEL_PATH,
		),
		numThreads: ttsConfig.numThreads,
		provider: ttsConfig.provider,
		maxNumSentences: ttsConfig.maxNumSentences,
		numSteps: ttsConfig.engineConfig?.numSteps ?? DEFAULT_SUPERTONIC_NUM_STEPS,
	},
	text,
	sid: sidOf(voiceName),
	speed,
	lang: langOf(ttsConfig),
})

const synthesizeSentences = async function* (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const ttsConfig = requireTtsConfig(domia)
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	const pool = getTtsPool(ttsConfig)
	for (const sentence of splitTextIntoSentences(text)) {
		const result = await pool.submit<TtsWorkerResultType>(
			jobOf(ttsConfig, sentence, voice.voiceName, voice.speed),
		)
		if (result.pcm.length > 0)
			yield applyEdgeFade(result.pcm, SUPERTONIC_SAMPLE_RATE)
	}
}

const runSupertonic = async (
	domia: DomiaType,
	text: string,
	options?: RunTtsOptionsType,
): Promise<RunTtsResultType> => {
	const ttsConfig = requireTtsConfig(domia)
	const voice = resolveTtsVoice(options?.voice, ttsConfig, domia)
	try {
		const parts: Buffer[] = []
		for await (const chunk of synthesizeSentences(domia, text, options))
			parts.push(chunk)
		const pcm = Buffer.concat(parts)
		const outputDir = path.resolve("tmp/tts-output")
		await mkdir(outputDir, { recursive: true })
		const filePath = path.join(outputDir, `domia-${generateUuid()}.wav`)
		await writeFile(filePath, wrapPcmToWav(pcm, SUPERTONIC_SAMPLE_RATE, 1, 16))
		return {
			engineUsed: TTS_ENGINE_ENUM.SUPERTONIC,
			voiceUsed: voice.voiceName,
			format: "wav",
			filePath,
			metadata: {
				text,
				sampleRate: SUPERTONIC_SAMPLE_RATE,
				samples: pcm.length / 2,
			},
		}
	} catch (error) {
		throw domiaError(TTS_ERRORS.TTS_FAILURE, {
			logger: ttsEngineLogger,
			meta: {
				message: error instanceof Error ? error.message : String(error),
				engine: TTS_ENGINE_ENUM.SUPERTONIC,
			},
		})
	}
}

export const supertonicEngine: TtsEngineAdapterType = {
	id: TTS_ENGINE_ENUM.SUPERTONIC,
	capabilities: {
		streaming: true,
		sampleRate: SUPERTONIC_SAMPLE_RATE,
		sampleFormat: "PCM_S16LE",
		channels: 1,
		languages: ["en", "es"],
	},
	run: runSupertonic,
	runStream: synthesizeSentences,
}

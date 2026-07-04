import {
	createInferencePool,
	createChildProcessBackend,
	resolveMaxWorkers,
	type InferencePoolType,
} from "@/modules/inference-pool"
import type { SelectTtsConfigType } from "@/db"
import type { DomiaType } from "@/modules/core"
import {
	applyMoodToVoice,
	getEmotionVectorFromEmotionState,
} from "@/modules/emotion-engine"
import {
	wavFileToPcmChunks,
	emotionTagPattern,
	collapseSpeechWhitespace,
} from "@/utils"
import type {
	TtsVoiceType,
	TtsVoiceInputType,
	TtsEngineAdapterType,
	RunTtsOptionsType,
} from "../types"

const SPEECH_ARTIFACT_CHARS = /["“”„‟«»‹›`*#]/g
const THINK_BLOCKS = /<think>[\s\S]*?<\/think>/g
const MARKDOWN_LINKS = /\[([^\]]*)\]\([^)]*\)/g
const EMOJI =
	/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|\u{20E3}|\u{FE0F}|\u{200D}/gu
const SMART_APOSTROPHES = /[‘’ʼ]/g

export const sanitizeForSpeech = (text: string): string =>
	collapseSpeechWhitespace(
		text
			.replace(THINK_BLOCKS, "")
			.replace(emotionTagPattern(), "")
			.replace(MARKDOWN_LINKS, "$1")
			.replace(SMART_APOSTROPHES, "'")
			.replace(SPEECH_ARTIFACT_CHARS, "")
			.replace(EMOJI, ""),
	)

export const ttsAdapterToPcmChunks = async function* (
	domia: DomiaType,
	adapter: TtsEngineAdapterType,
	text: string,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const speech = sanitizeForSpeech(text)
	if (!speech) return
	if (adapter.capabilities.streaming === true && adapter.runStream) {
		yield* adapter.runStream(domia, speech, options)
		return
	}
	const result = await adapter.run(domia, speech, options)
	if (!result?.filePath) return
	yield* wavFileToPcmChunks(result.filePath)
}

const moodShades = (domia: DomiaType): boolean =>
	domia.moduleSettings?.emotionEngine === true && domia.emotionState !== null

export const resolveTtsVoice = (
	override: TtsVoiceInputType | null | undefined,
	ttsConfig: SelectTtsConfigType,
	domia?: DomiaType,
): TtsVoiceType => {
	const base: TtsVoiceType = {
		voiceName: override?.voiceName ?? ttsConfig.voiceName,
		speed: override?.speed ?? ttsConfig.speed,
		silenceScale: override?.silenceScale ?? ttsConfig.silenceScale,
		pitch: override?.pitch ?? ttsConfig.pitch,
	}
	if (override?.speed != null || !domia || !moodShades(domia)) return base
	return applyMoodToVoice(
		base,
		getEmotionVectorFromEmotionState(domia.emotionState),
	)
}

export const ttsVoiceFromDomia = (domia: DomiaType): TtsVoiceType | null => {
	const c = domia.ttsConfig
	if (!c) return null
	const base: TtsVoiceType = {
		voiceName: c.voiceName,
		speed: c.speed,
		silenceScale: c.silenceScale,
		pitch: c.pitch,
	}
	if (!moodShades(domia)) return base
	return applyMoodToVoice(
		base,
		getEmotionVectorFromEmotionState(domia.emotionState),
	)
}

let ttsPool: InferencePoolType | null = null

export const getTtsPool = (
	ttsConfig: SelectTtsConfigType,
): InferencePoolType => {
	if (!ttsPool) {
		const maxWorkers = ttsConfig.poolAutoScaleEnabled
			? resolveMaxWorkers(ttsConfig.poolMaxWorkers, "tts")
			: Math.max(1, ttsConfig.poolWarmWorkers)
		ttsPool = createInferencePool({
			label: "tts",
			backend: createChildProcessBackend("tts-entry"),
			warmWorkers: ttsConfig.poolWarmWorkers,
			maxWorkers,
			idleTimeoutMs: ttsConfig.poolIdleTimeoutMs,
			queueMaxDepth: ttsConfig.poolQueueMaxDepth,
			queueTimeoutMs: ttsConfig.poolQueueTimeoutMs,
			executionTimeoutMs: ttsConfig.poolExecutionTimeoutMs,
			recycleAfterJobs: ttsConfig.workerRecycleAfterJobs,
		})
	}
	return ttsPool
}

export const ttsPoolBusy = (): boolean =>
	ttsPool !== null && (ttsPool.busyWorkers() > 0 || ttsPool.queuedJobs() > 0)

export const reloadTtsPool = async (): Promise<void> => {
	const old = ttsPool
	ttsPool = null
	if (old) await old.shutdown()
}

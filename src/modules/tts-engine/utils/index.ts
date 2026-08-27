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
	expressivenessForStyle,
	tagBoostedMood,
	EMOTION_TAG_PROSODY_BOOST,
	EMOTION_TAG_PROSODY_BLEND,
} from "@/modules/emotion-engine"
import {
	wavFileToPcmChunks,
	emotionTagPattern,
	emotionTagLoosePattern,
	collapseSpeechWhitespace,
	withIdleTimeout,
	ttsEngineLogger,
} from "@/utils"
import type {
	TtsVoiceType,
	TtsVoiceInputType,
	TtsEngineAdapterType,
	RunTtsOptionsType,
} from "../types"

const SPEECH_ARTIFACT_CHARS = /["“”„‟«»‹›`*#]/g
const BRACKET_GROUPS = /\[[^\]]{0,40}\]/g
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
			.replace(emotionTagLoosePattern(), "")
			.replace(MARKDOWN_LINKS, "$1")
			.replace(BRACKET_GROUPS, "")
			.replace(SMART_APOSTROPHES, "'")
			.replace(SPEECH_ARTIFACT_CHARS, "")
			.replace(EMOJI, ""),
	)

const TTS_STREAM_IDLE_MS = 30000

export const ttsAdapterToPcmChunks = async function* (
	domia: DomiaType,
	adapter: TtsEngineAdapterType,
	text: string,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const speech = sanitizeForSpeech(text)
	if (!speech) return
	if (adapter.capabilities.streaming === true && adapter.runStream) {
		yield* withIdleTimeout(
			adapter.runStream(domia, speech, options),
			TTS_STREAM_IDLE_MS,
			"tts",
		)
		return
	}
	const result = await adapter.run(domia, speech, options)
	if (!result?.filePath) return
	yield* wavFileToPcmChunks(result.filePath)
}

const phraseCache = new Map<string, Buffer[]>()
const phraseInflight = new Map<string, Promise<Buffer[]>>()

const phraseCacheKey = (
	domia: DomiaType,
	adapter: TtsEngineAdapterType,
	speech: string,
): string | null => {
	const cfg = domia.ttsConfig
	if (!cfg) return null
	const voice = resolveTtsVoice(undefined, cfg, domia)
	return [
		adapter.id,
		cfg.modelPath,
		cfg.language,
		voice.voiceName,
		voice.speed,
		voice.pitch,
		voice.silenceScale,
		speech.toLowerCase(),
	].join("|")
}

export const phraseCacheStats = (): { entries: number } => ({
	entries: phraseCache.size,
})

export const resetPhraseCache = (): void => {
	phraseCache.clear()
}

export const cachedTtsPcmChunks = async function* (
	domia: DomiaType,
	adapter: TtsEngineAdapterType,
	text: string,
): AsyncIterable<Buffer> {
	const cfg = domia.ttsConfig
	const speech = sanitizeForSpeech(text)
	if (
		!cfg?.phraseCacheEnabled ||
		!speech ||
		speech.length > cfg.phraseCacheMaxChars
	) {
		yield* ttsAdapterToPcmChunks(domia, adapter, text)
		return
	}
	const key = phraseCacheKey(domia, adapter, speech)
	if (!key) {
		yield* ttsAdapterToPcmChunks(domia, adapter, text)
		return
	}
	const serveHit = (hit: Buffer[]): Buffer[] => {
		phraseCache.delete(key)
		phraseCache.set(key, hit)
		ttsEngineLogger.info("🔊 phrase cache hit", {
			chars: speech.length,
			chunks: hit.length,
		})
		return hit
	}
	const hit = phraseCache.get(key)
	if (hit) {
		yield* serveHit(hit)
		return
	}
	const pending = phraseInflight.get(key)
	if (pending) {
		try {
			yield* serveHit(await pending)
			return
		} catch {
			const settled = phraseCache.get(key)
			if (settled) {
				yield* serveHit(settled)
				return
			}
		}
	}
	let resolveInflight: (chunks: Buffer[]) => void = () => undefined
	let rejectInflight: (err: Error) => void = () => undefined
	const inflight = new Promise<Buffer[]>((resolve, reject) => {
		resolveInflight = resolve
		rejectInflight = reject
	})
	inflight.catch(() => undefined)
	phraseInflight.set(key, inflight)
	const collected: Buffer[] = []
	let completed = false
	try {
		for await (const chunk of ttsAdapterToPcmChunks(domia, adapter, text)) {
			collected.push(chunk)
			yield chunk
		}
		completed = true
	} finally {
		phraseInflight.delete(key)
		if (completed && collected.length > 0) {
			phraseCache.set(key, collected)
			while (phraseCache.size > Math.max(1, cfg.phraseCacheEntries)) {
				const oldest = phraseCache.keys().next().value
				if (oldest === undefined) break
				phraseCache.delete(oldest)
			}
			resolveInflight(collected)
		} else {
			rejectInflight(new Error("tts synthesis incomplete"))
		}
	}
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
		expressivenessForStyle(domia.characterProfile?.emotionExpressionStyle),
	)
}

export const sentenceVoiceForTags = (
	domia: DomiaType,
	tags: string[],
): TtsVoiceType | null => {
	if (tags.length === 0 || !domia.ttsConfig || !moodShades(domia)) return null
	const c = domia.ttsConfig
	const base: TtsVoiceType = {
		voiceName: c.voiceName,
		speed: c.speed,
		silenceScale: c.silenceScale,
		pitch: c.pitch,
	}
	const mood = tagBoostedMood(
		getEmotionVectorFromEmotionState(domia.emotionState),
		tags,
		EMOTION_TAG_PROSODY_BOOST,
		EMOTION_TAG_PROSODY_BLEND,
	)
	return applyMoodToVoice(
		base,
		mood,
		expressivenessForStyle(domia.characterProfile?.emotionExpressionStyle),
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
		expressivenessForStyle(domia.characterProfile?.emotionExpressionStyle),
	)
}

const ttsPools = new Map<string, InferencePoolType>()

export const getTtsPool = (
	ttsConfig: SelectTtsConfigType,
): InferencePoolType => {
	const engine = ttsConfig.engine
	const existing = ttsPools.get(engine)
	if (existing) return existing
	const maxWorkers = ttsConfig.poolAutoScaleEnabled
		? resolveMaxWorkers(ttsConfig.poolMaxWorkers, "tts")
		: Math.max(1, ttsConfig.poolWarmWorkers)
	const pool = createInferencePool({
		label: `tts:${engine.toLowerCase()}`,
		backend: createChildProcessBackend("tts-entry"),
		warmWorkers: ttsConfig.poolWarmWorkers,
		maxWorkers,
		idleTimeoutMs: ttsConfig.poolIdleTimeoutMs,
		queueMaxDepth: ttsConfig.poolQueueMaxDepth,
		queueTimeoutMs: ttsConfig.poolQueueTimeoutMs,
		executionTimeoutMs: ttsConfig.poolExecutionTimeoutMs,
		recycleAfterJobs: ttsConfig.workerRecycleAfterJobs,
	})
	ttsPools.set(engine, pool)
	return pool
}

export const ttsPoolBusy = (): boolean => {
	for (const pool of ttsPools.values()) {
		if (pool.busyWorkers() > 0 || pool.queuedJobs() > 0) return true
	}
	return false
}

export const reloadTtsPool = async (): Promise<void> => {
	const old = [...ttsPools.values()]
	ttsPools.clear()
	await Promise.all(old.map((pool) => pool.shutdown()))
}

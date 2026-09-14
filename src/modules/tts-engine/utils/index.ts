import {
	createInferencePool,
	createChildProcessBackend,
	resolveMaxWorkers,
	type InferencePoolType,
} from "@/modules/inference-pool"
import { type SelectTtsConfigType } from "@/db"
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
	languageSetsFor,
} from "@/utils"
import type {
	TtsVoiceType,
	TtsVoiceInputType,
	TtsEngineAdapterType,
	RunTtsOptionsType,
	PhraseCacheEntryType,
	PhraseCacheStatsType,
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
	if (adapter.capabilities.streaming && adapter.runStream) {
		yield* withIdleTimeout(
			adapter.runStream(domia, speech, options),
			TTS_STREAM_IDLE_MS,
			"tts",
		)
		return
	}
	const result = await adapter.run(domia, speech, options)
	if (!result.filePath) return
	yield* wavFileToPcmChunks(result.filePath)
}

const phraseCache = new Map<string, PhraseCacheEntryType>()
const phraseInflight = new Map<string, Promise<Buffer[]>>()
let phraseCacheBytes = 0
let phraseCacheHits = 0
let phraseCacheMisses = 0

const quantize = (value: number, step: number): number =>
	Number((Math.round(value / step) * step).toFixed(4))

export const quantizeTtsVoice = (
	voice: TtsVoiceType,
	step: number,
): TtsVoiceType => ({
	voiceName: voice.voiceName,
	speed: quantize(voice.speed, step),
	pitch: quantize(voice.pitch, step),
	silenceScale: quantize(voice.silenceScale, step),
})

export const phraseCacheKey = (
	domia: DomiaType,
	adapter: TtsEngineAdapterType,
	speech: string,
	voice: TtsVoiceType,
): string | null => {
	const cfg = domia.ttsConfig
	if (!cfg) return null
	return [
		adapter.id,
		cfg.modelPath,
		cfg.language,
		voice.voiceName,
		voice.speed,
		voice.pitch,
		voice.silenceScale,
		speech,
	].join("|")
}

export const isPhraseCacheable = (
	cfg: SelectTtsConfigType | null | undefined,
	speech: string,
): boolean =>
	!!cfg?.phraseCacheEnabled &&
	speech.length > 0 &&
	speech.length <= cfg.phraseCacheMaxChars

export const cacheablePhrasesFor = (language?: string | null): string[] =>
	Object.values(languageSetsFor(language).phrases).filter(
		(phrase) => !/[{}]/.test(phrase),
	)

export const phraseCacheStats = (): PhraseCacheStatsType => ({
	entries: phraseCache.size,
	bytes: phraseCacheBytes,
	hits: phraseCacheHits,
	misses: phraseCacheMisses,
})

export const resetPhraseCache = (): void => {
	phraseCache.clear()
	phraseInflight.clear()
	phraseCacheBytes = 0
	phraseCacheHits = 0
	phraseCacheMisses = 0
}

const evictPhraseCache = (cfg: SelectTtsConfigType): void => {
	const maxEntries = Math.max(1, cfg.phraseCacheEntries)
	const maxBytes = Math.max(0, cfg.phraseCacheMaxBytes)
	while (
		phraseCache.size > maxEntries ||
		(maxBytes > 0 && phraseCacheBytes > maxBytes && phraseCache.size > 1)
	) {
		const oldest = phraseCache.keys().next().value
		if (oldest === undefined) break
		const entry = phraseCache.get(oldest)
		phraseCache.delete(oldest)
		phraseCacheBytes -= entry?.bytes ?? 0
	}
}

const storePhrase = (
	cfg: SelectTtsConfigType,
	key: string,
	chunks: Buffer[],
): void => {
	const bytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
	const maxBytes = Math.max(0, cfg.phraseCacheMaxBytes)
	if (maxBytes > 0 && bytes > maxBytes) return
	const previous = phraseCache.get(key)
	if (previous) phraseCacheBytes -= previous.bytes
	phraseCache.set(key, { chunks, bytes })
	phraseCacheBytes += bytes
	evictPhraseCache(cfg)
}

export const cachedTtsPcmChunks = async function* (
	domia: DomiaType,
	adapter: TtsEngineAdapterType,
	text: string,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const cfg = domia.ttsConfig
	const speech = sanitizeForSpeech(text)
	if (!cfg || !isPhraseCacheable(cfg, speech)) {
		yield* ttsAdapterToPcmChunks(domia, adapter, text, options)
		return
	}
	const voice = quantizeTtsVoice(
		resolveTtsVoice(options?.voice, cfg),
		cfg.phraseCacheVoiceStep,
	)
	const key = phraseCacheKey(domia, adapter, speech, voice)
	if (!key) {
		yield* ttsAdapterToPcmChunks(domia, adapter, text, options)
		return
	}
	const serveHit = (chunks: Buffer[]): Buffer[] => {
		const entry = phraseCache.get(key)
		if (entry) {
			phraseCache.delete(key)
			phraseCache.set(key, entry)
		}
		phraseCacheHits++
		ttsEngineLogger.info("🔊 phrase cache hit", {
			chars: speech.length,
			chunks: chunks.length,
		})
		return chunks
	}
	const hit = phraseCache.get(key)
	if (hit) {
		yield* serveHit(hit.chunks)
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
				yield* serveHit(settled.chunks)
				return
			}
		}
	}
	phraseCacheMisses++
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
		for await (const chunk of ttsAdapterToPcmChunks(domia, adapter, text, {
			...options,
			voice,
		})) {
			collected.push(chunk)
			yield chunk
		}
		completed = true
	} finally {
		phraseInflight.delete(key)
		if (completed && collected.length > 0) {
			storePhrase(cfg, key, collected)
			resolveInflight(collected)
		} else {
			rejectInflight(new Error("tts synthesis incomplete"))
		}
	}
}

export const warmPhraseCache = async (
	domia: DomiaType,
	adapter: TtsEngineAdapterType,
): Promise<number> => {
	const phrases = cacheablePhrasesFor(domia.characterProfile?.language)
	let warmed = 0
	for (const phrase of phrases) {
		for await (const chunk of cachedTtsPcmChunks(domia, adapter, phrase))
			void chunk
		warmed++
	}
	return warmed
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

export const createTtsPool = (
	ttsConfig: SelectTtsConfigType,
): InferencePoolType => {
	const engine = ttsConfig.engine
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
	return pool
}

export const getTtsPool = (
	ttsConfig: SelectTtsConfigType,
): InferencePoolType => {
	const engine = ttsConfig.engine
	const existing = ttsPools.get(engine)
	if (existing) return existing
	const pool = createTtsPool(ttsConfig)
	ttsPools.set(engine, pool)
	return pool
}

export const ttsPoolBusy = (): boolean => {
	for (const pool of ttsPools.values()) {
		if (pool.busyWorkers() > 0 || pool.queuedJobs() > 0) return true
	}
	return false
}

export const swapTtsPool = async (
	engine: string,
	next: InferencePoolType,
): Promise<void> => {
	const stale = [...ttsPools.entries()].map(([, pool]) => pool)
	ttsPools.clear()
	ttsPools.set(engine, next)
	await Promise.all(stale.map((pool) => pool.shutdown()))
}

export const shutdownTtsPools = async (): Promise<void> => {
	const old = [...ttsPools.values()]
	ttsPools.clear()
	await Promise.all(old.map((pool) => pool.shutdown()))
}

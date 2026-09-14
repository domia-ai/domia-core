import { rm } from "fs/promises"

import { type DomiaType } from "@/modules/core"
import {
	DEFAULT_PCM_SAMPLE_RATE,
	DEFAULT_TTS_PREWARM_PASSES,
	DEFAULT_VAD_PREWARM_ON_BOOT,
} from "@/db"
import { warmupLogger, languageSetsFor } from "@/utils"
import { runTTS, getTtsEngine, warmPhraseCache } from "@/modules/tts-engine"
import { runSttPcmPooled, getSttEngine } from "@/modules/stt-engine"
import { warmTurnDetector } from "@/modules/turn-detector"
import { warmupLLM } from "@/modules/llm-engine"
import { createVadWindow } from "@/modules/audio-capture"
import type { RuntimeCapabilitiesType } from "@/setups/environment"

const STT_SAMPLE_RATE = DEFAULT_PCM_SAMPLE_RATE
const STT_WARM_SILENCE = Buffer.alloc(STT_SAMPLE_RATE * 2)
const ONNX_WARM_PASSES = 2
const VAD_WARM_MS = 200

const warmupPhrase = (domia: DomiaType): string =>
	languageSetsFor(domia.characterProfile?.language).phrases.warmup

const timed = async (
	label: string,
	fn: () => Promise<unknown>,
): Promise<void> => {
	const start = Date.now()
	try {
		await fn()
		warmupLogger.info(`🔥 warmup ${label} ready in ${Date.now() - start}ms`)
	} catch (err) {
		warmupLogger.warn(`⚠️ warmup ${label} failed (cold first turn)`, { err })
	}
}

const warmStt = (domia: DomiaType): Promise<void> =>
	timed("STT", async () => {
		for (let i = 0; i < ONNX_WARM_PASSES; i++) {
			await runSttPcmPooled(domia, STT_WARM_SILENCE)
		}
		const engine = domia.sttConfig?.engine
			? getSttEngine(domia.sttConfig.engine)
			: null
		if (!engine?.createSession) return
		const sessions = Math.max(1, domia.sttConfig?.poolWarmWorkers ?? 1)
		await Promise.all(
			Array.from({ length: sessions }, async () => {
				const session = engine.createSession?.(domia)
				if (!session) return
				session.pushChunk(STT_WARM_SILENCE)
				await session.finish()
			}),
		)
	})

const ttsPrewarmPasses = (domia: DomiaType): number =>
	Math.max(1, domia.ttsConfig?.prewarmPasses ?? DEFAULT_TTS_PREWARM_PASSES)

const ttsWarmWorkers = (domia: DomiaType): number =>
	Math.max(1, domia.ttsConfig?.poolWarmWorkers ?? 1)

const prewarmTtsPool = async (domia: DomiaType): Promise<void> => {
	const text = warmupPhrase(domia)
	for (let i = 0; i < ttsPrewarmPasses(domia); i++) {
		await Promise.all(
			Array.from({ length: ttsWarmWorkers(domia) }, async () => {
				const { filePath } = await runTTS(domia, text)
				if (filePath) await rm(filePath, { force: true }).catch(() => undefined)
			}),
		)
	}
}

const warmTts = (domia: DomiaType): Promise<void> =>
	timed("TTS", () => prewarmTtsPool(domia))

const warmPhrases = (domia: DomiaType): Promise<void> =>
	timed("TTS phrase cache", async () => {
		const engine = domia.ttsConfig?.engine
		const adapter = engine ? getTtsEngine(engine) : null
		if (!adapter) return
		const warmed = await warmPhraseCache(domia, adapter)
		warmupLogger.info(`🔥 phrase cache warmed (${warmed} phrases)`)
	})

const warmVad = (domia: DomiaType): Promise<void> =>
	timed("VAD", () => {
		const config = domia.wakeWordConfig
		if (!config) return Promise.resolve()
		const window = createVadWindow(config)
		const frames = Math.max(
			1,
			Math.round((config.sampleRate * VAD_WARM_MS) / 1000),
		)
		window.feed(Buffer.alloc(frames * 2))
		return Promise.resolve()
	})

const warmLlm = (domia: DomiaType): Promise<void> =>
	timed("LLM", () => warmupLLM(domia))

export const warmupOnBoot = (
	domia: DomiaType,
	capabilities: RuntimeCapabilitiesType,
): void => {
	if (!domia.warmupOnBoot) return
	const tasks: Promise<void>[] = []
	const sttEngine = domia.sttConfig?.engine
		? getSttEngine(domia.sttConfig.engine)
		: null
	const sttInProcess = Boolean(sttEngine) && !sttEngine?.capabilities.external
	if (capabilities.stt && sttInProcess && domia.sttConfig?.modelPath)
		tasks.push(warmStt(domia))
	if (capabilities.llm && domia.llmModelConfig?.modelName)
		tasks.push(warmLlm(domia))
	if (
		capabilities.tts &&
		domia.ttsConfig?.modelPath &&
		domia.ttsConfig.prewarmOnBoot
	) {
		const warmPhrasesEnabled =
			domia.ttsConfig.phraseCacheEnabled &&
			domia.ttsConfig.phraseCacheWarmupEnabled
		tasks.push(
			warmPhrasesEnabled
				? warmTts(domia).then(() => warmPhrases(domia))
				: warmTts(domia),
		)
	}
	if (
		capabilities.wakeword &&
		capabilities.record &&
		(domia.wakeWordConfig?.vadPrewarmOnBoot ?? DEFAULT_VAD_PREWARM_ON_BOOT)
	)
		tasks.push(warmVad(domia))
	if (domia.wakeWordConfig?.acousticEndpointingEnabled)
		warmTurnDetector(
			domia.wakeWordConfig.turnDetectorModelPath,
			domia.wakeWordConfig.turnDetectorEngine,
		)
	if (tasks.length === 0) return
	warmupLogger.info(`🔥 warming local models (${tasks.length} stages)`)
	void Promise.allSettled(tasks).then(() =>
		warmupLogger.info(`🔥 warmup complete — first turn is hot`),
	)
}

export const warmupAfterTtsReload = (domia: DomiaType): void => {
	if (!domia.ttsConfig?.prewarmOnReload) return
	void timed("TTS reload", async () => {
		await prewarmTtsPool(domia)
		if (
			domia.ttsConfig?.phraseCacheEnabled &&
			domia.ttsConfig.phraseCacheWarmupEnabled
		)
			await warmPhrases(domia)
	})
}

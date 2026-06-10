import {
	createInferencePool,
	createChildProcessBackend,
	resolveMaxWorkers,
	drainAndShutdown,
	type InferencePoolType,
} from "@/modules/inference-pool"
import type { SelectTtsConfigType } from "@/db"
import type { DomiaType } from "@/modules/core"
import { wavFileToPcmChunks } from "@/utils"
import type {
	TtsVoiceType,
	TtsVoiceInputType,
	TtsEngineAdapterType,
	RunTtsOptionsType,
} from "../types"

export const ttsAdapterToPcmChunks = async function* (
	domia: DomiaType,
	adapter: TtsEngineAdapterType,
	text: string,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	if (adapter.capabilities.streaming === true && adapter.runStream) {
		yield* adapter.runStream(domia, text, options)
		return
	}
	const result = await adapter.run(domia, text, options)
	if (!result?.filePath) return
	yield* wavFileToPcmChunks(result.filePath)
}

export const resolveTtsVoice = (
	override: TtsVoiceInputType | null | undefined,
	ttsConfig: SelectTtsConfigType,
): TtsVoiceType => ({
	voiceName: override?.voiceName ?? ttsConfig.voiceName,
	speed: override?.speed ?? ttsConfig.speed,
	silenceScale: override?.silenceScale ?? ttsConfig.silenceScale,
	pitch: override?.pitch ?? ttsConfig.pitch,
})

export const ttsVoiceFromDomia = (domia: DomiaType): TtsVoiceType | null => {
	const c = domia.ttsConfig
	if (!c) return null
	return {
		voiceName: c.voiceName,
		speed: c.speed,
		silenceScale: c.silenceScale,
		pitch: c.pitch,
	}
}

let ttsPool: InferencePoolType | null = null

export const getTtsPool = (
	ttsConfig: SelectTtsConfigType,
): InferencePoolType => {
	if (!ttsPool) {
		const maxWorkers = ttsConfig.poolAutoScaleEnabled
			? resolveMaxWorkers(ttsConfig.poolMaxWorkers)
			: Math.max(1, ttsConfig.poolWarmWorkers)
		ttsPool = createInferencePool({
			label: "tts",
			backend: createChildProcessBackend("tts-entry"),
			warmWorkers: ttsConfig.poolWarmWorkers,
			maxWorkers,
			idleTimeoutMs: ttsConfig.poolIdleTimeoutMs,
			queueMaxDepth: ttsConfig.poolQueueMaxDepth,
			queueTimeoutMs: ttsConfig.poolQueueTimeoutMs,
			recycleAfterJobs: ttsConfig.workerRecycleAfterJobs,
		})
	}
	return ttsPool
}

const POOL_RECYCLE_DRAIN_TIMEOUT_MS = 15_000

export const recycleTtsPool = async (): Promise<void> => {
	const pool = ttsPool
	ttsPool = null
	if (pool) await drainAndShutdown(pool, POOL_RECYCLE_DRAIN_TIMEOUT_MS)
}

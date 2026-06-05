import {
	createInferencePool,
	createChildProcessBackend,
	resolveMaxWorkers,
	type InferencePoolType,
} from "@/modules/inference-pool"
import type { SelectTtsConfigType } from "@/db"
import type { DomiaType } from "@/modules/core"
import type { TtsVoiceType, TtsVoiceInputType } from "../types"

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

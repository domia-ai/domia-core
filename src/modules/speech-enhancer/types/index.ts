import type { SpeechEnhancerEngineEnumType } from "@/db"

export type SpeechEnhancerStageType = {
	active: boolean
	process: (pcm: Buffer) => Buffer
	flush: () => Buffer
	close: () => void
}

export type SpeechEnhancerTuningType = {
	modelPath: string
	numThreads: number
	provider: string
}

export type SpeechEnhancerCapabilitiesType = {
	sampleRate: number
}

export type SpeechEnhancerEngineAdapterType = {
	id: SpeechEnhancerEngineEnumType
	capabilities: SpeechEnhancerCapabilitiesType
	available: (modelPath: string) => boolean
	createStage: (tuning: SpeechEnhancerTuningType) => SpeechEnhancerStageType
}

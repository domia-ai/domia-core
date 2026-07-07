import type { VadEngineEnumType } from "@/db"

export type VadSessionType = {
	acceptSamples: (samples: Float32Array) => void
	isSpeechActive: () => boolean
	hasCompletedSegment: () => boolean
	silenceMs: () => number
	everDetected: () => boolean
	reset: () => void
}

export type VadCapabilitiesType = {
	sampleRate: number
	windowSize: number
}

export type VadEngineAdapterType = {
	id: VadEngineEnumType
	capabilities: VadCapabilitiesType
	createSession: (modelPath: string, tuning: VadTuningType) => VadSessionType
}

export type VadTuningType = {
	threshold: number
	minSilenceS: number
	endOfSpeechMs: number
	numThreads: number
	provider: string
}

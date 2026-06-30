export type VadSessionType = {
	acceptSamples: (samples: Float32Array) => void
	isSpeechActive: () => boolean
	hasCompletedSegment: () => boolean
	silenceMs: () => number
	everDetected: () => boolean
	reset: () => void
}

export type VadEngineAdapterType = {
	id: string
	sampleRate: number
	windowSize: number
	createSession: (modelPath: string, tuning: VadTuningType) => VadSessionType
}

export type VadTuningType = {
	threshold: number
	minSilenceS: number
	endOfSpeechMs: number
	numThreads: number
	provider: string
}

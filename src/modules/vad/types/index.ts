export type VadSessionType = {
	acceptSamples: (samples: Float32Array) => void
	isSpeechActive: () => boolean
	hasCompletedSegment: () => boolean
	reset: () => void
}

export type VadEngineAdapterType = {
	id: string
	sampleRate: number
	windowSize: number
	createSession: (modelPath: string) => VadSessionType
}

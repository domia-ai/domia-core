export type Waveform = {
	sampleRate: number
	samples: Float32Array
}

export type OfflineStream = {
	handle: unknown
	acceptWaveform: (input: Waveform) => void
}

export type OfflineRecognizerResult = {
	text: string
	tokens?: string[]
	timestamps?: number[]
}

export type OfflineRecognizerConfig = Record<string, unknown>

export type OfflineRecognizerInstance = {
	createStream: () => OfflineStream
	decode: (stream: OfflineStream) => void
	getResult: (stream: OfflineStream) => OfflineRecognizerResult
}

export type GeneratedAudio = {
	samples: Float32Array
	sampleRate: number
}

export type TtsGenerationConfig = {
	sid: number
	speed: number
	silenceScale?: number
}

export type OfflineTtsInstance = {
	sampleRate: number
	numSpeakers: number
	generate: (req: {
		text: string
		generationConfig?: TtsGenerationConfig
	}) => GeneratedAudio
}

export type OfflineTtsConfig = Record<string, unknown>

export type KeywordResult = {
	keyword: string
	tokens?: string[]
}

export type KeywordStream = OfflineStream

export type KeywordSpotterInstance = {
	createStream: () => KeywordStream
	isReady: (stream: KeywordStream) => boolean
	decode: (stream: KeywordStream) => void
	reset: (stream: KeywordStream) => void
	getResult: (stream: KeywordStream) => KeywordResult
}

export type KeywordSpotterConfig = Record<string, unknown>

export type VadConfig = Record<string, unknown>

export type VadInstance = {
	acceptWaveform: (samples: Float32Array) => void
	isDetected: () => boolean
	isEmpty: () => boolean
	flush: () => void
	reset: () => void
}

export type RuntimeAddon = {
	OfflineRecognizer: new (config: unknown) => unknown
	OfflineTts: new (config: unknown) => unknown
	KeywordSpotter: new (config: unknown) => unknown
	Vad: new (config: unknown, bufferSizeInSeconds: number) => unknown
	readWave: (filePath: string) => Waveform
	writeWave: (filePath: string, wave: Waveform) => void
}

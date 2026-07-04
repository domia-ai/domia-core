export type CaptureCallbacksType = {
	onWake?: () => void | Promise<void>
	onRecordingStart?: () => void | Promise<void>
	onRecordingEnd?: (filePath: string) => void | Promise<void>
	onError?: (error: Error) => void | Promise<void>
}

export type CaptureHandleType = {
	stop: () => void
}

export type StartAudioStreamResultType = {
	chunks: AsyncIterable<Buffer>
	filePathPromise: Promise<string>
	speechEndAt: () => number | null
	stop: () => void
}

export type FollowUpRecordingResultType = {
	filePath: string
	speechEndAt: number | null
}

export type SpeculativeCaptureHooksType = {
	onSpeculate: (pcm: Buffer) => void
	onResume: (pcm: Buffer) => void
	onChunk?: (pcm: Buffer) => void
}

export type SpeculativeCaptureResultType = {
	finalPcmPromise: Promise<Buffer>
	filePathPromise: Promise<string>
	speechEndAt: () => number | null
	stop: () => void
	setDebounceMs?: (ms: number) => void
}

export type FollowUpSpeculativeCaptureType = {
	speechStarted: Promise<boolean>
	attach: (hooks: SpeculativeCaptureHooksType) => SpeculativeCaptureResultType
	stop: () => void
}

export type KwsPathsType = {
	dir: string
	encoder: string
	decoder: string
	joiner: string
	tokens: string
	keywords: string
}

export type VadWindowType = {
	feed: (data: Buffer) => void
	completed: () => boolean
	speechActive: () => boolean
	silenceMs: () => number
	everDetected: () => boolean
}

export type StopSoxType = (reason: string) => void

export type CaptureFormatType = {
	sampleRate: number
	channels: number
	bitsPerSample: number
}

export type MicTapListenerType = (chunk: Buffer) => void

export type MicTapRingEntryType = { at: number; chunk: Buffer }

export type MicTapStateType = {
	listeners: Set<MicTapListenerType>
	ring: MicTapRingEntryType[]
	ringBytes: number
	lastChunkAt: number
	format: CaptureFormatType | null
}

export type MicSourceType = {
	onData: (handler: (chunk: Buffer) => void) => void
	stop: (reason: string) => void
	closed: Promise<void>
	viaTap: boolean
}

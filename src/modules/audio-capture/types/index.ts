import type { DomiaType } from "@/modules/core"
import type { SelectWakeWordConfigType, WakeWordEngineEnumType } from "@/db"

export type CaptureCallbacksType = {
	onWake?: (keyword: string) => void | Promise<void>
	onWakeRejected?: (keyword: string) => void | Promise<void>
	onRecordingStart?: () => void | Promise<void>
	onRecordingEnd?: (filePath: string) => void | Promise<void>
	onError?: (error: Error) => void | Promise<void>
}

export type CaptureHandleType = {
	stop: () => void
}

export type WakeWordCapabilitiesType = {
	sampleRate: number
}

export type WakeWordEngineAdapterType = {
	id: WakeWordEngineEnumType
	capabilities: WakeWordCapabilitiesType
	run: (
		domia: DomiaType,
		callbacks?: CaptureCallbacksType,
	) => Promise<CaptureHandleType>
}

export type StartAudioStreamResultType = {
	debounceMs: number
	endpointObservedMs: () => number | null
	chunks: AsyncIterable<Buffer>
	filePathPromise: Promise<string>
	speechEndAt: () => number | null
	stop: () => void
}

export type FollowUpRecordingResultType = {
	debounceMs: number
	endpointObservedMs: () => number | null
	filePath: string
	speechEndAt: number | null
}

export type SpeculativeCaptureHooksType = {
	onSpeculate: (pcm: Buffer) => void
	onResume: (pcm: Buffer) => void
	onChunk?: (pcm: Buffer) => void
}

export type SpeculativeCaptureResultType = {
	debounceMs: number
	endpointObservedMs: () => number | null
	finalPcmPromise: Promise<Buffer>
	filePathPromise: Promise<string>
	speechEndAt: () => number | null
	endpointDecisionAt?: () => number | null
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
	holdMs: () => number
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

export type DynamicEndpointStateType = {
	pauseEmaMs: number
}

export type PlaybackReferenceType = {
	ring: Float32Array
	writePos: number
	totalWritten: number
	lastSampleAt: number
}

export type EchoGateConfigType = Pick<
	SelectWakeWordConfigType,
	| "echoResidualGateEnabled"
	| "echoResidualMinRatio"
	| "echoResidualWindowMs"
	| "echoResidualMaxDelayMs"
	| "echoResidualMinRms"
	| "echoResidualMinFrames"
>

export type EchoGateVerdictType = {
	accept: boolean
	frames: number
	rms: number
	residual: number | null
	lagMs: number | null
}

export type EchoGateType = {
	observe: (pcm16k: Buffer) => EchoGateVerdictType
	reset: () => void
}

export type StopWordConfigType = Pick<
	SelectWakeWordConfigType,
	"stopWordAbortEnabled" | "stopWordMaxWords"
>

import type { ResolvedDelegateType } from "@/modules/capability-resolver"
import type {
	AudioReadyPayload,
	SttDonePayload,
	LlmDonePayload,
	TtsDonePayload,
} from "@/generated/proto/domia"

export type DeliverEventTarget = ResolvedDelegateType

export type DeliverEventPayloadMap = {
	audioReady: AudioReadyPayload
	sttDone: SttDonePayload
	llmDone: LlmDonePayload
	ttsDone: TtsDonePayload
}

export type DeliverEventResult = {
	delivered: boolean
	deduplicated: boolean
	target?: DeliverEventTarget
	error?: string
	attemptedTargets: number
}

export type StreamSttMetaType = {
	originDomiaKey?: string
	interactionId?: string
	responseType?: string
}

export type StreamSttResult = {
	delivered: boolean
	transcript?: string
	interactionId?: string
	originDomiaKey?: string
	responseType?: string
	target?: DeliverEventTarget
	error?: string
	unsupported?: boolean
	attemptedTargets: number
}

export type StreamLlmRequestType = {
	transcript: string
	originDomiaKey?: string
	interactionId?: string
	responseType?: string
	personaContextJson?: string
}

export type StreamLlmResult = {
	delivered: boolean
	tokens?: AsyncIterable<string>
	target?: DeliverEventTarget
	error?: string
	unsupported?: boolean
	attemptedTargets: number
}

export type StreamTtsRequestType = {
	reply: string
	originDomiaKey?: string
	interactionId?: string
}

export type StreamTtsResult = {
	delivered: boolean
	audio?: AsyncIterable<Buffer>
	sampleRate?: number
	channels?: number
	target?: DeliverEventTarget
	error?: string
	unsupported?: boolean
	attemptedTargets: number
}

export type StreamReplyAudioRequestType = {
	transcript: string
	originDomiaKey?: string
	interactionId?: string
	responseType?: string
	personaContextJson?: string
}

export type StreamReplyAudioResult = {
	delivered: boolean
	audio?: AsyncIterable<Buffer>
	finalReplyPromise?: Promise<string>
	sampleRate?: number
	channels?: number
	target?: DeliverEventTarget
	error?: string
	unsupported?: boolean
	atCapacity?: boolean
	attemptedTargets: number
}

export type StreamVoiceReplyRequestType = {
	originDomiaKey?: string
	interactionId?: string
	responseType?: string
	personaContextJson?: string
	audioFactory: () => AsyncIterable<Buffer>
}

export type StreamVoiceReplyResult = {
	delivered: boolean
	audio?: AsyncIterable<Buffer>
	transcriptPromise?: Promise<string>
	finalReplyPromise?: Promise<string>
	audioMeta?: { sampleRate?: number; channels?: number }
	target?: DeliverEventTarget
	error?: string
	unsupported?: boolean
	atCapacity?: boolean
	attemptedTargets: number
}

export type OpenedServerStream<T> = {
	delivered: boolean
	target?: DeliverEventTarget
	error?: string
	unsupported?: boolean
	atCapacity?: boolean
	attemptedTargets: number
	firstValue?: T
	stream?: AsyncIterable<T>
}

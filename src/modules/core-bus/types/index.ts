import { type PlaybackStatusType } from "@/buses"
import { type DomiaType } from "@/modules/core"
import { type RuntimeCapabilitiesType } from "@/setups/environment"
import type { SttEngineAdapterType } from "@/modules/stt-engine"
import type { TtsEngineAdapterType } from "@/modules/tts-engine"
import type { LlmEngineAdapterType } from "@/modules/llm-engine"
import type { RecentTurnType } from "@/modules/prompt-context-builder"

export type ResolvedSttEngineType = {
	adapter: SttEngineAdapterType
	canStream: boolean
} | null

export type ResolvedTtsEngineType = {
	adapter: TtsEngineAdapterType
	canStream: boolean
} | null

export type ResolvedLlmEngineType = {
	adapter: LlmEngineAdapterType
	canStream: boolean
} | null

export type CoreBusFeaturesType = {
	capabilities: RuntimeCapabilitiesType
	stt: ResolvedSttEngineType
	tts: ResolvedTtsEngineType
	llm: ResolvedLlmEngineType
	canRunStt: boolean
	canRunLlm: boolean
	canRunTts: boolean
	canPlayback: boolean
	canStreamStt: boolean
	canStreamLlm: boolean
	canStreamTts: boolean
	canSentencePipeline: boolean
}

export type CoreBusContextType = {
	domia: DomiaType
	features: CoreBusFeaturesType
}

export type AudioReadyPayloadType = {
	speechEndAt?: number
	liveVoice?: boolean
	filePath?: string
	audioUrl?: string
	originDomiaKey?: string
	interactionId?: string
	traceId?: string
}

export type SttDonePayloadType = {
	transcript: string
	interactionId?: string
	originDomiaKey?: string
	responseType?: string
	alreadyHandled?: boolean
	prestartedTokens?: AsyncIterable<string>
	prestartedPrompt?: string
	prestartedExecutorKey?: string
	prestartedRelease?: () => void
	speechEndAt?: number
	liveVoice?: boolean
	traceId?: string
}

export type LlmDonePayloadType = {
	reply: string
	transcript?: string
	interactionId?: string
	originDomiaKey?: string
	responseType?: string
	alreadyStreamed?: boolean
	speechEndAt?: number
	liveVoice?: boolean
	traceId?: string
}

export type TtsDonePayloadType = {
	filePath?: string
	reply?: string
	transcript?: string
	interactionId?: string
	originDomiaKey?: string
	audioUrl?: string
	liveVoice?: boolean
	traceId?: string
}

export type AudioErrorPayloadType = {
	error: Error
}

export type CapabilityMissingPayloadType = {
	capability: string
	interactionId?: string
	originDomiaKey?: string
	responseType?: string
}

export type InteractionFailedPayloadType = {
	interactionId: string
	originDomiaKey?: string
	responseType?: string
	error: string
	step?: string
	liveVoice?: boolean
}

export type NotifyInteractionFailedArgsType = {
	interactionId: string
	originDomiaKey?: string
	responseType?: string
	error: Error | string
	step?: string
	silent?: boolean
	liveVoice?: boolean
}

export type AudioFallbackReasonType = "tts_failed" | "playback_failed"

export type NotifyAudioFallbackArgsType = {
	interactionId: string
	originDomiaKey?: string
	reason: AudioFallbackReasonType
	error: Error | string
	reply?: string
}

export type ServeEntryType = {
	filePath: string
	createdAt: number
}

export type RequestVoiceReplyStage = "stt" | "llm" | "tts" | "firstAudioChunk"

export type PlaybackStartedPayloadType = {
	interactionId?: string
	originDomiaKey?: string
	traceId?: string
}

export type PlaybackFinishedPayloadType = {
	interactionId?: string
	originDomiaKey?: string
	status?: PlaybackStatusType
	playedLocally?: boolean
	liveVoice?: boolean
	traceId?: string
}

export type RequestVoiceReplyOptions = {
	timeoutMs?: number
	speak?: boolean
	onStage?: (stage: RequestVoiceReplyStage, elapsedMs: number) => void
}

export type RequestVoiceReplyResult = {
	interactionId: string
	transcript: string
	reply: string
	ttsFilePath?: string
}

export type RequestTextReplyResult = {
	interactionId: string
	reply: string
}

export type RequestTextToVoiceReplyResult = {
	interactionId: string
	reply: string
	ttsFilePath?: string
}

export type TokenQueueType = {
	push: (token: string) => void
	close: () => void
	iter: () => AsyncIterable<string>
}

export type SpeculationType = {
	generation: number
	cancelled: boolean
	started: boolean
	queue: TokenQueueType
	prompt: string | null
	executorKey: string | null
	ready: Promise<string | null>
}

export type SpeculativeTurnArgsType = {
	interactionId: string
	release: () => void
}

export type PlaybackOutcomeType = {
	filePath: string | undefined
	interrupted: boolean
	audioStarted: boolean
}

export type MemoryBundleType = {
	recentTurns: RecentTurnType[]
	knownFacts: string[]
	userMoodTrend: string[]
}

export type SttFlowSessionType = {
	speechEndAt?: number
	liveVoice?: boolean
	interactionId: string
	promptContext: string
	transcript: string
	originDomiaKey: string | undefined
	responseType: string | undefined
	isVoice: boolean
	recentTurns: RecentTurnType[]
	knownFacts: string[]
	userMoodTrend: string[]
}

export type LlmFlowSessionType = {
	speechEndAt?: number
	liveVoice?: boolean
	interactionId: string
	reply: string
	transcript: string | undefined
	originDomiaKey: string | undefined
	responseType: string | undefined
}

export type PendingEntryType = {
	resolve: (reply: string) => void
	reject: (err: Error) => void
	timeoutId: ReturnType<typeof setTimeout>
}

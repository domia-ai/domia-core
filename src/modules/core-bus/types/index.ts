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
	interactionId?: string
	satelliteId?: string
	satelliteProtocol?: SatelliteProtocolType
	onStage?: (stage: RequestVoiceReplyStage, elapsedMs: number) => void
}

export type SatelliteAnnouncerType = (url: string) => void

export type StreamingSinkFormatType = {
	sampleRate: number
	channels: 1 | 2
}

export type StreamingSinkType = {
	begin?: (format: StreamingSinkFormatType) => void | Promise<void>
	write: (chunk: Buffer) => void | Promise<void>
	end?: () => void | Promise<void>
}

export type StreamMetaType = {
	interactionId: string
	originDomiaKey: string | undefined
	onFirstChunk?: () => void
	aborted?: () => boolean
}

export type TurnScopeType = {
	domiaId: string
	interactionId: string
	signal: AbortSignal
	aborted: () => boolean
	reason: () => string | null
	abort: (reason: string) => void
	end: () => void
}

export type IntercomLinkType = {
	to: string
	sink: StreamingSinkType
}

export type SpeakResultType = {
	delivered: boolean
	target: "satellite" | "local" | "none"
	audioId?: string
	audioPath?: string
}

export type SpeakBroadcastResultType = {
	delivered: string[]
}

export type SpokenDomiaResultType = {
	domia: DomiaType
	result: SpeakResultType
}

export type RenderedTtsType = {
	url: string | null
	id: string
	filePath: string
}

export type PresenceStatusType = "idle" | "listening" | "thinking" | "speaking"

export type SatelliteProtocolType = "native" | "wyoming" | "esphome"

export type SatelliteWakeWordType = {
	id: string
	wakeWord: string
}

export type SatelliteNumberEntityType = {
	id: string
	name: string
	value: number | null
	min: number | null
	max: number | null
	step: number | null
	unit: string | null
}

export type SatelliteCapabilitiesType = {
	canHear: boolean
	canSpeak: boolean
	canAnnounce: boolean
	canIntercom: boolean
	canFollowUp: boolean
}

export type SatelliteEventKindType =
	| "wake"
	| "audio"
	| "playback"
	| "announce"
	| "reconnect"
	| "error"

export type SatelliteEventType = {
	id: string
	kind: SatelliteEventKindType
	detail: string
	at: number
}

export type SatellitePresenceType = {
	satelliteId: string
	protocol: SatelliteProtocolType
	connected: boolean
	connecting: boolean
	connectedAt: number | null
	lastError: string | null
	lastErrorAt: number | null
	reconnectCount: number
	micActive: boolean
	sampleRate: number | null
	lastTurnAt: number | null
	lastPlaybackAt: number | null
	availableWakeWords: SatelliteWakeWordType[]
	activeWakeWords: string[]
	numberEntities: SatelliteNumberEntityType[]
	capabilities: SatelliteCapabilitiesType
	firmwareVersion: string | null
	recentEvents: SatelliteEventType[]
}

export type SatelliteMetaPatchType = Partial<
	Pick<
		SatellitePresenceType,
		| "reconnectCount"
		| "micActive"
		| "sampleRate"
		| "lastTurnAt"
		| "lastPlaybackAt"
		| "availableWakeWords"
		| "activeWakeWords"
		| "numberEntities"
		| "firmwareVersion"
	>
>

export type SetSatellitePresenceMetaType = {
	capabilities?: SatelliteCapabilitiesType
	connectionId?: string
}

export type SatelliteControlType = {
	satelliteId: string
	domiaKey: string
	setWakeWords: (ids: string[]) => void
	announce: (url: string) => void
	setNumber?: (entityId: string, value: number) => void
	setFollowUp?: (enabled: boolean) => void
}

export type PresenceEntryType = {
	domiaKey: string
	status: PresenceStatusType
	lastActiveAt: number | null
	satellites: SatellitePresenceType[]
}

export type PresenceListenerType = (status: PresenceStatusType) => void

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

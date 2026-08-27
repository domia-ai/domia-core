import type { SkillElicitResultType } from "@/modules/skill-engine"
import type {
	DomiaEventBusPayloadMapType,
	DOMIA_EVENT_BUS_ENUM,
	TurnEventInputSourceType,
} from "@/buses"
import { INTERACTION_STATUS_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import { type RuntimeCapabilitiesType } from "@/setups/environment"
import type {
	SttEngineAdapterType,
	SttStreamSessionType,
} from "@/modules/stt-engine"
import type { TtsEngineAdapterType } from "@/modules/tts-engine"
import type { LlmEngineAdapterType } from "@/modules/llm-engine"
import type { RecentTurnType } from "@/modules/prompt-context-builder"
import type {
	SpeculativeCaptureHooksType,
	SpeculativeCaptureResultType,
} from "@/modules/audio-capture"

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

export type AudioReadyPayloadType =
	DomiaEventBusPayloadMapType[DOMIA_EVENT_BUS_ENUM.AUDIO_READY]

export type SttDonePayloadType =
	DomiaEventBusPayloadMapType[DOMIA_EVENT_BUS_ENUM.STT_DONE]

export type LlmDonePayloadType =
	DomiaEventBusPayloadMapType[DOMIA_EVENT_BUS_ENUM.LLM_DONE]

export type TtsDonePayloadType =
	DomiaEventBusPayloadMapType[DOMIA_EVENT_BUS_ENUM.TTS_DONE]

export type AudioErrorPayloadType =
	DomiaEventBusPayloadMapType[DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR]

export type CapabilityMissingPayloadType =
	DomiaEventBusPayloadMapType[DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING]

export type InteractionFailedPayloadType =
	DomiaEventBusPayloadMapType[DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED]

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

export type PlaybackStartedPayloadType =
	DomiaEventBusPayloadMapType[DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED]

export type PlaybackFinishedPayloadType =
	DomiaEventBusPayloadMapType[DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED]

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

export type SinkPositionFidelityType =
	| "exact"
	| "estimated"
	| "sentence"
	| "none"

export type SinkCapabilitiesType = {
	pause: boolean
	position: SinkPositionFidelityType
	urlPlayback: boolean
	captions: boolean
}

export type LedgerAnchorType = {
	text: string
	startByte: number
	endByte: number
}

export type PlaybackLedgerType = {
	format: StreamingSinkFormatType
	totalBytes: () => number
	anchors: () => LedgerAnchorType[]
	wordLevelHeard: boolean
	markFirstChunk: () => void
	addBytes: (n: number) => void
	wrapSentence: (
		text: string,
		pcm: AsyncIterable<Buffer>,
	) => AsyncIterable<Buffer>
	pause: () => void
	resume: () => void
	isPaused: () => boolean
	waitResume: () => Promise<void>
	releaseGate: () => void
	positionMs: () => number | undefined
	heardTextAt: (
		positionMs: number,
		fidelity: SinkPositionFidelityType,
	) => string
}

export type StreamingSinkType = {
	begin?: (format: StreamingSinkFormatType) => void | Promise<void>
	write: (chunk: Buffer) => void | Promise<void>
	end?: () => void | Promise<void>
	capabilities?: SinkCapabilitiesType
	pause?: () => boolean
	resume?: () => boolean
}

export type StreamMetaType = {
	interactionId: string
	originDomiaKey: string | undefined
	onFirstChunk?: () => void
	aborted?: () => boolean
	ledger?: PlaybackLedgerType
}

export type TurnSessionContextType = {
	session: SttFlowSessionType
	scope: TurnScopeType | null
	turnSignal: AbortSignal | undefined
}

export type TurnScopeType = {
	domiaId: string
	interactionId: string
	signal: AbortSignal
	aborted: () => boolean
	reason: () => string | null
	abort: (reason: string) => void
	end: () => void
	settled: Promise<void>
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

export type SatelliteProtocolType =
	| "native"
	| "wyoming"
	| "esphome"
	| "livekit"
	| "openai-realtime"

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
	volume: number | null
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
		| "volume"
		| "firmwareVersion"
	>
>

export type SetSatellitePresenceMetaType = {
	capabilities?: SatelliteCapabilitiesType
	connectionId?: string
}

export type SatelliteTimerEventType = {
	eventType: "started" | "updated" | "cancelled" | "finished"
	timerId: string
	name: string
	totalSeconds: number
	secondsLeft: number
	isActive: boolean
}

export type TimerIntentType = {
	seconds: number
	label: string
}

export type FastIntentContextType = {
	domia: DomiaType
	interactionId: string
	originDomiaKey: string
	satelliteId: string | undefined
	transcript: string
}

export type FastIntentType = {
	name: string
	match: (
		text: string,
		ctx: FastIntentContextType,
	) => Record<string, unknown> | null
	handle: (
		params: Record<string, unknown>,
		ctx: FastIntentContextType,
	) => string | null
}

export type FastIntentResultType = {
	name: string
	confirm: string
}

export type StreamingAudioType = {
	queue: import("./sentence-buffer").AsyncQueueType<Buffer>
	sampleRate: number
	channels: number
}

export type ActiveTimerType = {
	timerId: string
	domiaKey: string
	satelliteId: string
	name: string
	totalSeconds: number
	startedAt: number
	handle: ReturnType<typeof setTimeout>
}

export type SatelliteControlType = {
	satelliteId: string
	domiaKey: string
	setWakeWords: (ids: string[]) => void
	announce: (url: string) => void
	setNumber?: (entityId: string, value: number) => void
	setVolume?: (volume: number) => void
	setFollowUp?: (enabled: boolean) => void
	sendTimerEvent?: (event: SatelliteTimerEventType) => void
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

export type InteractionStatusType =
	(typeof INTERACTION_STATUS_ENUM_VALUES)[number]

export type InteractionInputModeType = "audio" | "transcript" | "text"

export type InteractionAudioDeliveryType =
	| "local-playback"
	| "streaming-sink"
	| "audio-url"
	| "none"

export type InteractionTimingsType = {
	createdAt: number
	inputStartedAt?: number
	speechEndAt?: number
	firstAudioAt?: number
	completedAt?: number
}

export type InteractionCompletionResultType = {
	transcript: string
	reply: string
	ttsFilePath?: string
	audioUrl?: string
	interrupted: boolean
}

export type PartialResultType = {
	transcript: string
	reply: string
	ttsFilePath?: string
	audioUrl?: string
}

export type CompletionHandleType = {
	resolve: (result: InteractionCompletionResultType) => void
	reject: (err: Error) => void
	timeout: ReturnType<typeof setTimeout>
}

export type InteractionRuntimeDeliveryType = {
	audioDelivery: InteractionAudioDeliveryType
	wantsTranscript?: boolean
}

export type InteractionRuntimeCallbacksType = {
	onStage?: (stage: RequestVoiceReplyStage, elapsedMs: number) => void
	onTranscript?: (text: string) => void
	onComplete?: (result: InteractionCompletionResultType) => void
	onError?: (error: string, step?: string) => void
}

export type InteractionRuntimeType = {
	envelope: InteractionEnvelopeType
	timings: InteractionTimingsType
	liveVoice?: boolean
	delivery: InteractionRuntimeDeliveryType
	callbacks: InteractionRuntimeCallbacksType
}

export type InteractionSourceType = TurnEventInputSourceType

export type InteractionInputType =
	| { kind: "audio_file"; filePath: string; inputAudioMs?: number }
	| { kind: "audio_stream"; speechEndAt?: number }
	| { kind: "transcript"; transcript: string }
	| { kind: "text"; text: string }

export type InteractionOutputRequestType = {
	kind: "voice" | "text"
}

export type InteractionEnvelopeType = {
	interactionId: string
	traceId?: string
	originDomiaKey: string
	runtimeDomiaKey: string
	targetDomiaKey?: string
	satelliteId?: string
	source: InteractionSourceType
	input: InteractionInputType
	requestedOutput: InteractionOutputRequestType
}

export type OutputSinkTerminalType = "dispatch" | "playback"

export type StageEnvelopeType = {
	interactionId: string
	originDomiaKey: string
	satelliteId?: string
	traceId?: string
}

export type DeliverySinkType = {
	terminalAt: OutputSinkTerminalType
	deliver?: (
		ctx: CoreBusContextType,
		interactionId: string,
		payload: TtsDonePayloadType,
	) => Promise<void>
}

export type RunInteractionInputType = Exclude<
	InteractionInputType,
	{ kind: "audio_stream" }
>

export type RunInteractionOptionsType = {
	input: RunInteractionInputType
	requestedOutput: InteractionOutputRequestType
	source: InteractionSourceType
	audioDelivery: InteractionAudioDeliveryType
	interactionId?: string
	satelliteId?: string
	satelliteProtocol?: SatelliteProtocolType
	timeoutMs?: number
	onStage?: (stage: RequestVoiceReplyStage, elapsedMs: number) => void
	liveTurn?: boolean
	prefetch?: boolean
	reflect?: boolean
}

export type RunInteractionResultType = InteractionCompletionResultType & {
	interactionId: string
}

export type InteractionRequestType = {
	input: InteractionInputType
	requestedOutput: InteractionOutputRequestType
	source: InteractionSourceType
	interactionId?: string
	satelliteId?: string
	satelliteProtocol?: SatelliteProtocolType
}

export type InteractionRuntimeOptionsType = {
	audioDelivery: InteractionAudioDeliveryType
	createdAt?: number
	liveTurn?: boolean
	prefetch?: boolean
	wantsTranscript?: boolean
	sink?: StreamingSinkType
	onStage?: (stage: RequestVoiceReplyStage, elapsedMs: number) => void
	onTranscript?: (text: string) => void
	onComplete?: (result: InteractionCompletionResultType) => void
	onError?: (error: string, step?: string) => void
}

export type BeginInteractionHandleType = {
	interactionId: string
	turn: TurnScopeType | null
}

export type RequestTextToVoiceReplyResult = {
	interactionId: string
	reply: string
	ttsFilePath?: string
}

export type TokenQueueType = {
	push: (token: string) => void
	close: () => void
	isClosed: () => boolean
	iter: () => AsyncIterable<string>
}

export type SpeculationType = {
	generation: number
	cancelled: boolean
	started: boolean
	handedOff: boolean
	queue: TokenQueueType
	outQueue: TokenQueueType | null
	tokenSource: AsyncIterable<string> | null
	firstUnitText: string | null
	firstUnitPcm: Promise<Buffer | null> | null
	prompt: string | null
	executorKey: string | null
	llmQueuedAt: number | null
	llmFirstTokenAt: number | null
	ready: Promise<string | null>
}

export type PipelinePrefixType = {
	text: string
	pcm: Promise<Buffer | null>
}

export type SpeculativeTurnPublishType = {
	responseType?: string
	liveVoice?: boolean
}

export type SpeculativeTurnArgsType = {
	interactionId: string
	release: () => void
	replaySinceTs?: number
	existingSttSession?: () => SttStreamSessionType | null
	publish?: SpeculativeTurnPublishType
	captureFactory?: (
		hooks: SpeculativeCaptureHooksType,
	) => SpeculativeCaptureResultType
}

export type PlaybackOutcomeType = {
	filePath: string | undefined
	interrupted: boolean
	audioStarted: boolean
	positionMs?: number
	positionFidelity?: SinkPositionFidelityType
	heardText?: string
}

export type MemoryBundleType = {
	recentTurns: RecentTurnType[]
	knownFacts: string[]
	knowledgeBase: string[]
	previously: string[]
	userModel: string | null
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
	knowledgeBase: string[]
	previously: string[]
	userModel: string | null
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

export type ExtractedEmotionTagsType = {
	tags: string[]
	clean: string
}

export type SentenceEmotionTagsType = {
	applyTags: string[]
	carryTags: string[]
}

export type SpeculationStatsType = {
	handedOff: number
	wastedFirstUnit: number
	discarded: number
	wasteRate: number
}

export type BargeInStatsType = {
	resumed: number
	escalated: number
	recoveryRate: number
}

export type EouMetricsType = {
	transcriptionDelayMs: number | null
	eouDelayMs: number | null
	endpointDebounceMs: number | null
}

export type EouMetricsInputType = {
	transcriptionDelayMs?: number | null
	eouDelayMs?: number | null
	endpointDebounceMs?: number | null
}

export type LadderStageType =
	| "speechEndAt"
	| "endpointDecisionAt"
	| "sttFinalAt"
	| "promptReadyAt"
	| "llmQueuedAt"
	| "llmFirstTokenAt"
	| "ttsFirstUnitAt"
	| "audioDeliveredAt"
	| "audioAudibleAt"

export type LadderTimestampsType = Partial<Record<LadderStageType, number>>

export type ForwardFailurePayloadType = {
	interactionId: string | undefined
	originDomiaKey: string | undefined
	responseType: string | undefined
	error: string
	step: string | undefined
}

export type PersistTerminalOptsType = {
	errorStep?: string
	errorMessage?: string
	errorCode?: string
}

export type InteractionAudioPatchType = {
	ttsFilePath?: string
	audioUrl?: string
}

export type CompleteInteractionOptsType = {
	interrupted?: boolean
	result?: Partial<InteractionCompletionResultType>
}

export type ReplyFallbackResultType = {
	reply: string
	usedFallback: boolean
}

export type HeardReplyPlaybackType = Pick<
	PlaybackOutcomeType,
	"audioStarted" | "interrupted" | "heardText"
>

export type DownloadAudioOptionsType = {
	timeoutMs?: number
}

export type StreamAudioFormatType = {
	sampleRate: number
	channels: 1 | 2
}

export type TimerUnitType = {
	re: RegExp
	mult: number
}

export type SpokenPositionOptsType = {
	wordLevelHeard: boolean
}

export type TurnCompletionGuardOptsType = {
	status?: string
	traceId?: string
}

export type PendingElicitType = {
	message: string
	requestedSchema: Record<string, unknown> | undefined
	language: string | null
	resolve: (result: SkillElicitResultType) => void
	timer: ReturnType<typeof setTimeout>
}

export type SpeakTargetType =
	| { kind: "local" }
	| { kind: "satellite"; satelliteId: string }
	| { kind: "broadcast" }

import type { SinkCapabilitiesType } from "@/modules/core-bus"
import type { DomiaType } from "@/modules/core"
import type { SttStreamSessionType } from "@/modules/stt-engine"
import type { EchoGateType, VadWindowType } from "@/modules/audio-capture"
import type {
	StreamingSinkFormatType,
	SatelliteProtocolType,
} from "@/modules/core-bus"

export type SatelliteHelloArgsType = {
	domiaKey?: string
	satelliteId?: string
	sampleRate?: number
	channels?: number
}

export type SatelliteTransportType = {
	sendReady: (domiaKey: string, name: string) => void
	sendTranscript: (text: string, interactionId: string) => void
	onTurnStarted?: (interactionId: string) => void
	onTurnFinished?: (interactionId: string) => void
	sendReplyDone: (reply: string, interactionId: string) => void
	sendError: (message: string) => void
	beginAudio: (format: StreamingSinkFormatType, interactionId?: string) => void
	writeAudio: (chunk: Buffer) => void | Promise<void>
	endAudio: () => void
	close: () => void
	serverEndpointing?: boolean
	notifySpeechEnd?: () => void
	playAudioUrl?: (url: string, interactionId: string) => void
	announce?: (url: string) => void
	finishTurn?: () => void
	externalMediaPlaying?: () => boolean
	followUp?: boolean
	pauseAudio?: () => boolean
	resumeAudio?: () => boolean
	outputCapabilities?: SinkCapabilitiesType
}

export type SatelliteSessionDepsType = {
	fallback: DomiaType
	transport: SatelliteTransportType
	protocol: SatelliteProtocolType
}

export type SatelliteSessionType = {
	onHello: (args: SatelliteHelloArgsType) => Promise<void>
	setFormat: (sampleRate: number, channels: number) => void
	onAudio: (pcm: Buffer) => void
	onSpeechEnd: () => Promise<void>
	onAudioPlayed: (interactionId?: string) => void
	onCancel: () => void
	setMinListenUntil: (ts: number) => void
	hasPendingUtterance: () => boolean
	onClose: () => void
}

export type SatelliteSessionStateType = {
	identity: DomiaType
	satelliteId: string
	sampleRate: number
	channels: number
	chunks: Buffer[]
	bufferedBytes: number
	helloReceived: boolean
	busy: boolean
	interruptingTurn: boolean
	echoGate: EchoGateType | null
	pausedBargeIn: ReturnType<typeof setTimeout> | null
	echoWindowUntil: number
	ttsBytesSent: number
	ttsFirstSentAt: number
	activeInteractionId: string | null
	activeFinalize: (() => void) | null
	registeredKey: string | null
	sttSession: SttStreamSessionType | null
	sttSessionTried: boolean
	connectionId: string
	minListenUntil: number
	urlPlayback: boolean
	serverEndpointing: boolean
	vad: VadWindowType | null
	vadDebounceMs: number
	effectiveDebounceMs: number
	endpointed: boolean
	micActiveFlag: boolean
	configRefreshTimer: ReturnType<typeof setInterval> | null
	acousticChecking: boolean
	acousticComplete: boolean
	lastAcousticRunAt: number
	utteranceGen: number
	gateHolding: boolean
	vadCompletedAt: number | null
	semanticHintApplied: boolean
	pendingInteractionId: string | null
	spec: SatelliteSpeculationType | null
	specStarting: boolean
	outputTail: Promise<void>
}

export type ReconnectSchedulerType = {
	isClosed: () => boolean
	attempts: () => number
	reset: () => void
	schedule: (fn: () => void) => void
	close: (onClose?: () => void) => void
}

export type SatelliteSpeculationArgsType = {
	identity: DomiaType
	interactionId: string
	sttSession: () => SttStreamSessionType | null
	vadDebounceMs: number
	bufferedPcm: () => Buffer
	bargeIn?: boolean
}

export type SatelliteSpeculationHandoffType = {
	pcm: Buffer
	speechEndAt?: number
	endpointDecisionAt?: number
	filePathPromise: Promise<string>
}

export type SatelliteSpeculationType = {
	interactionId: string
	feed: (pcm: Buffer, cumulativePcm: () => Buffer) => void
	handoff: (args: SatelliteSpeculationHandoffType) => void
	abort: (reason: string) => void
	release: () => void
	done: Promise<void>
}

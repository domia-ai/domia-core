import type { SinkCapabilitiesType } from "@/modules/core-bus"
import type { DomiaType } from "@/modules/core"
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
	sendTranscript: (text: string) => void
	sendReplyDone: (reply: string, interactionId: string) => void
	sendError: (message: string) => void
	beginAudio: (format: StreamingSinkFormatType) => void
	writeAudio: (chunk: Buffer) => void | Promise<void>
	endAudio: () => void
	close: () => void
	serverEndpointing?: boolean
	notifySpeechEnd?: () => void
	playAudioUrl?: (url: string, interactionId: string) => void
	announce?: (url: string) => void
	finishTurn?: () => void
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
	onCancel: () => void
	onClose: () => void
}

export type SatelliteAdapterHandleType = {
	close: () => void
}

export type SatelliteProtocolAdapterType = {
	name: string
	start: (ctx: { fallback: DomiaType }) => SatelliteAdapterHandleType
}

export type ReconnectSchedulerType = {
	isClosed: () => boolean
	attempts: () => number
	reset: () => void
	schedule: (fn: () => void) => void
	close: (onClose?: () => void) => void
}

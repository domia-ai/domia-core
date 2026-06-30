import type { WebSocketServer } from "ws"

export type SatelliteHelloType = {
	type: "hello"
	satelliteId: string
	domiaKey?: string
	token?: string
	sampleRate?: number
	channels?: number
}

export type SatelliteControlType =
	| SatelliteHelloType
	| { type: "speech_end" }
	| { type: "cancel" }

export type SatelliteReadyType = {
	type: "ready"
	domiaKey: string
	name: string
}

export type SatelliteTranscriptType = {
	type: "transcript"
	text: string
}

export type SatelliteReplyDoneType = {
	type: "reply_done"
	reply: string
	interactionId: string
}

export type SatelliteAudioStreamBeginType = {
	type: "audio_stream_begin"
	sampleRate: number
	channels: number
}

export type SatelliteAudioStreamEndType = {
	type: "audio_stream_end"
}

export type SatelliteSpeechEndType = {
	type: "speech_end"
}

export type SatelliteErrorType = {
	type: "error"
	message: string
}

export type SatelliteDownMessageType =
	| SatelliteReadyType
	| SatelliteTranscriptType
	| SatelliteReplyDoneType
	| SatelliteAudioStreamBeginType
	| SatelliteAudioStreamEndType
	| SatelliteSpeechEndType
	| SatelliteErrorType

export type SatelliteGatewayHandleType = {
	close: () => void
	server: WebSocketServer
}

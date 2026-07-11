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

export type SatelliteSpeechStoppedType = {
	type: "speech_stopped"
}

export type SatelliteErrorType = {
	type: "error"
	message: string
}

export type SatelliteAudioPauseType = { type: "audio_pause" }

export type SatelliteAudioResumeType = { type: "audio_resume" }

export type SatelliteDownMessageType =
	| SatelliteReadyType
	| SatelliteTranscriptType
	| SatelliteReplyDoneType
	| SatelliteAudioStreamBeginType
	| SatelliteAudioStreamEndType
	| SatelliteAudioPauseType
	| SatelliteAudioResumeType
	| SatelliteSpeechStoppedType
	| SatelliteErrorType

export type SatelliteGatewayHandleType = {
	close: () => void
	server: WebSocketServer
}

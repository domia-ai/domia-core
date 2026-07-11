import type { WebSocketServer } from "ws"

export type RealtimeTurnDetectionType = { type?: string } | null

export type RealtimeSessionUpdateType = {
	type: "session.update"
	session?: {
		turn_detection?: RealtimeTurnDetectionType
		audio?: {
			input?: { format?: { type?: string; rate?: number; channels?: number } }
		}
		input_audio_format?: string
	}
}

export type RealtimeClientEventType =
	| RealtimeSessionUpdateType
	| { type: "input_audio_buffer.append"; audio: string }
	| { type: "input_audio_buffer.commit" }
	| { type: "input_audio_buffer.clear" }
	| { type: "response.create" }
	| { type: "response.cancel" }

export type RealtimeServerEventType = {
	type: string
	event_id: string
	[key: string]: unknown
}

export type RealtimeGatewayHandleType = {
	close: () => void
	server: WebSocketServer
}

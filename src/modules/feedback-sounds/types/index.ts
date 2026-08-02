export type FeedbackSoundKindType =
	| "ack"
	| "error"
	| "done"
	| "thinking"
	| "endpoint"

export type AcknowledgeEndpointOptsType = {
	playSound?: boolean
	sinceSpeechEndMs?: number
	originDomiaKey?: string
}

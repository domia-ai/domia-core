import type { StreamingSinkType } from "../types"

const sinks = new Map<string, StreamingSinkType>()

export const registerStreamingSink = (
	interactionId: string,
	sink: StreamingSinkType,
): void => {
	sinks.set(interactionId, sink)
}

export const getStreamingSink = (
	interactionId: string,
): StreamingSinkType | undefined => sinks.get(interactionId)

export const clearStreamingSink = (interactionId: string): void => {
	sinks.delete(interactionId)
}

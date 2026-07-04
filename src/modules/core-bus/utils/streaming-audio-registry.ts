import { AsyncQueue } from "./sentence-buffer"
import type { StreamingAudioType } from "../types"

const streams = new Map<string, StreamingAudioType>()

export const openAudioStream = (
	interactionId: string,
	sampleRate: number,
	channels: number,
): StreamingAudioType => {
	const stream: StreamingAudioType = {
		queue: new AsyncQueue<Buffer>(),
		sampleRate,
		channels,
	}
	streams.set(interactionId, stream)
	return stream
}

export const writeAudioStream = (
	interactionId: string,
	chunk: Buffer,
): void => {
	streams.get(interactionId)?.queue.push(chunk)
}

export const closeAudioStream = (interactionId: string): void => {
	const stream = streams.get(interactionId)
	if (!stream) return
	stream.queue.close()
	setTimeout(() => streams.delete(interactionId), 30_000).unref?.()
}

export const getAudioStream = (
	interactionId: string,
): StreamingAudioType | undefined => streams.get(interactionId)

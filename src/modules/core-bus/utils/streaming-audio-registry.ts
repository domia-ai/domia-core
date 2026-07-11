import { createAsyncQueue } from "./sentence-buffer"
import type { StreamingAudioType } from "../types"

const streams = new Map<string, StreamingAudioType>()

const AUDIO_STREAM_MAX_QUEUED_CHUNKS = 64

export const openAudioStream = (
	interactionId: string,
	sampleRate: number,
	channels: number,
): StreamingAudioType => {
	const stream: StreamingAudioType = {
		queue: createAsyncQueue<Buffer>(),
		sampleRate,
		channels,
	}
	streams.set(interactionId, stream)
	return stream
}

export const writeAudioStream = async (
	interactionId: string,
	chunk: Buffer,
): Promise<void> => {
	const stream = streams.get(interactionId)
	if (!stream) return
	await stream.queue.waitForSpace(AUDIO_STREAM_MAX_QUEUED_CHUNKS)
	stream.queue.push(chunk)
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

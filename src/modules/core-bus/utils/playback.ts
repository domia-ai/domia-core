import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { playAudioStream } from "@/modules/audio-playback"
import { createWavStreamWriter, domiaBusLogger } from "@/utils"
import { registerAudioForServing } from "./audio"
import { getStreamingSink } from "./streaming-sink"
import type {
	CoreBusContextType,
	PlaybackOutcomeType,
	StreamingSinkType,
	StreamMetaType,
} from "../types"

export const DEFAULT_SAMPLE_RATE = 24000
export const DEFAULT_CHANNELS = 1

const finalizeArchive = async (
	writer: ReturnType<typeof createWavStreamWriter>,
	interactionId: string,
): Promise<string | undefined> => {
	try {
		const filePath = await writer.finalize()
		registerAudioForServing(interactionId, filePath)
		return filePath
	} catch (err) {
		domiaBusLogger.warn("archival finalize failed (best-effort)", { err })
		return undefined
	}
}

const streamToSink = async (
	ctx: CoreBusContextType,
	audio: AsyncIterable<Buffer>,
	meta: StreamMetaType,
	format: { sampleRate: number; channels: 1 | 2 },
	sink: StreamingSinkType,
): Promise<PlaybackOutcomeType> => {
	let firstChunkEmitted = false
	let interrupted = false
	const writer = createWavStreamWriter(
		meta.interactionId,
		format.sampleRate,
		format.channels,
		16,
		"tts",
	)
	let wroteAny = false
	try {
		await sink.begin?.(format)
		try {
			for await (const chunk of audio) {
				if (meta.aborted?.()) {
					interrupted = true
					break
				}
				writer.write(chunk)
				wroteAny = true
				if (!firstChunkEmitted) {
					firstChunkEmitted = true
					meta.onFirstChunk?.()
					publishToDomiaBus(
						ctx.domia.id,
						DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED,
						{
							interactionId: meta.interactionId,
							originDomiaKey: meta.originDomiaKey,
						},
					)
				}
				await sink.write(chunk)
			}
		} finally {
			await sink.end?.()
		}
		if (!wroteAny)
			return { filePath: undefined, interrupted, audioStarted: false }
		const filePath = await finalizeArchive(writer, meta.interactionId)
		return { filePath, interrupted, audioStarted: firstChunkEmitted }
	} finally {
		await writer.abort()
	}
}

export const playStreamedAudio = async (
	ctx: CoreBusContextType,
	audio: AsyncIterable<Buffer>,
	meta: StreamMetaType,
	format: { sampleRate: number; channels: 1 | 2 },
): Promise<PlaybackOutcomeType> => {
	const sink = getStreamingSink(meta.interactionId)
	if (sink) return streamToSink(ctx, audio, meta, format, sink)
	let firstChunkEmitted = false
	let aborted = false
	const writer = createWavStreamWriter(
		meta.interactionId,
		format.sampleRate,
		format.channels,
		16,
		"tts",
	)
	let wroteAny = false
	try {
		const captured = (async function* (): AsyncIterable<Buffer> {
			for await (const chunk of audio) {
				if (meta.aborted?.()) {
					aborted = true
					break
				}
				writer.write(chunk)
				wroteAny = true
				yield chunk
			}
		})()

		const result = await playAudioStream(ctx.domia, captured, {
			sampleRate: format.sampleRate,
			channels: format.channels,
			bitsPerSample: 16,
			onFirstChunkWritten: () => {
				if (firstChunkEmitted) return
				firstChunkEmitted = true
				meta.onFirstChunk?.()
				publishToDomiaBus(ctx.domia.id, DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED, {
					interactionId: meta.interactionId,
					originDomiaKey: meta.originDomiaKey,
				})
			},
		})
		if (result && result.success === false) {
			throw new Error(`audio playback failed (engine ${result.engine})`)
		}
		const interrupted = result?.interrupted === true || aborted
		const audioStarted = firstChunkEmitted

		if (!wroteAny) return { filePath: undefined, interrupted, audioStarted }
		const filePath = await finalizeArchive(writer, meta.interactionId)
		return { filePath, interrupted, audioStarted }
	} finally {
		await writer.abort()
	}
}

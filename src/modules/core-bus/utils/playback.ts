import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { playAudioStream } from "@/modules/audio-playback"
import { wrapPcmToWav, writeWavToTemp } from "@/utils"
import { registerAudioForServing } from "./audio"
import type { CoreBusContextType } from "../types"

export const DEFAULT_SAMPLE_RATE = 24000
export const DEFAULT_CHANNELS = 1

export const playStreamedAudio = async (
	ctx: CoreBusContextType,
	audio: AsyncIterable<Buffer>,
	meta: {
		interactionId: string
		originDomiaKey: string | undefined
		onFirstChunk?: () => void
	},
	format: { sampleRate: number; channels: 1 | 2 },
): Promise<string | undefined> => {
	let firstChunkEmitted = false
	const chunks: Buffer[] = []
	const captured = (async function* (): AsyncIterable<Buffer> {
		for await (const chunk of audio) {
			chunks.push(chunk)
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

	if (chunks.length === 0) return undefined
	const wav = wrapPcmToWav(
		Buffer.concat(chunks),
		format.sampleRate,
		format.channels,
		16,
	)
	const filePath = await writeWavToTemp(wav, meta.interactionId, "tts")
	registerAudioForServing(meta.interactionId, filePath)
	return filePath
}

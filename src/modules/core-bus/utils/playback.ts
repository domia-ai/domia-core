import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { playAudioStream } from "@/modules/audio-playback"
import type { CoreBusContextType } from "../types"

export const DEFAULT_SAMPLE_RATE = 24000

export const playStreamedAudio = async (
	ctx: CoreBusContextType,
	audio: AsyncIterable<Buffer>,
	meta: { interactionId: string; originDomiaKey: string | undefined },
	format: { sampleRate: number; channels: 1 | 2 },
): Promise<void> => {
	let firstChunkEmitted = false
	await playAudioStream(ctx.domia, audio, {
		sampleRate: format.sampleRate,
		channels: format.channels,
		bitsPerSample: 16,
		onFirstChunkWritten: () => {
			if (firstChunkEmitted) return
			firstChunkEmitted = true
			publishToDomiaBus(ctx.domia.id, DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED, {
				interactionId: meta.interactionId,
				originDomiaKey: meta.originDomiaKey,
			})
		},
	})
}

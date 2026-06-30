import { domiaBusLogger } from "@/utils"
import { normalizeRuntimeCapabilities } from "@/setups/environment"
import { type DomiaType, getOwnDomia } from "@/modules/core"
import { playAudioStream } from "@/modules/audio-playback"
import {
	getSatelliteSinkFor,
	getSatelliteAnnouncerFor,
} from "./satellite-registry"
import { resolveCoreBusFeatures } from "./features"
import type { StreamingSinkType } from "../types"

const MAX_QUEUED_CHUNKS = 200

const makeLocalPlaybackSink = (domia: DomiaType): StreamingSinkType => {
	const buffered: Buffer[] = []
	let notify: (() => void) | null = null
	let closed = false
	let dropped = 0

	const chunks = (async function* (): AsyncIterable<Buffer> {
		while (true) {
			const next = buffered.shift()
			if (next) {
				yield next
				continue
			}
			if (closed) return
			await new Promise<void>((resolve) => {
				notify = resolve
			})
		}
	})()

	let playback: Promise<unknown> | null = null

	return {
		begin: (format) => {
			playback = playAudioStream(domia, chunks, {
				sampleRate: format.sampleRate,
				channels: format.channels,
				bitsPerSample: 16,
			}).catch((err) => {
				domiaBusLogger.warn("local intercom playback failed", {
					err: err instanceof Error ? err.message : String(err),
					domiaKey: domia.domiaKey,
				})
			})
		},
		write: (chunk) => {
			if (closed) return
			buffered.push(chunk)
			if (buffered.length > MAX_QUEUED_CHUNKS) {
				buffered.shift()
				dropped++
				if (dropped === 1 || dropped % 100 === 0)
					domiaBusLogger.warn("local intercom dropping chunks (playback lag)", {
						dropped,
						domiaKey: domia.domiaKey,
					})
			}
			notify?.()
			notify = null
		},
		end: async () => {
			closed = true
			notify?.()
			notify = null
			await playback
		},
	}
}

export const resolveIntercomSink = async (
	toDomiaKey: string,
): Promise<StreamingSinkType | null> => {
	const satellite = getSatelliteSinkFor(toDomiaKey)
	if (satellite) return satellite

	if (getSatelliteAnnouncerFor(toDomiaKey)) return null

	const domia = await getOwnDomia(toDomiaKey).catch(() => null)
	if (!domia) return null
	const capabilities = normalizeRuntimeCapabilities(
		domia.runtimeCapabilities ?? {},
	)
	const features = resolveCoreBusFeatures(domia, capabilities)
	if (!features.canPlayback) return null
	if (domia.audioPlaybackConfig?.streamingEnabled === false) return null

	return makeLocalPlaybackSink(domia)
}

export const canDeliverIntercom = async (
	toDomiaKey: string,
): Promise<boolean> => {
	if (getSatelliteSinkFor(toDomiaKey)) return true
	if (getSatelliteAnnouncerFor(toDomiaKey)) return false

	const domia = await getOwnDomia(toDomiaKey).catch(() => null)
	if (!domia) return false
	const features = resolveCoreBusFeatures(
		domia,
		normalizeRuntimeCapabilities(domia.runtimeCapabilities ?? {}),
	)
	if (!features.canPlayback) return false
	return domia.audioPlaybackConfig?.streamingEnabled !== false
}

export const canDeliverBroadcast = async (
	toDomiaKey: string,
): Promise<boolean> => {
	if (getSatelliteSinkFor(toDomiaKey)) return true
	if (getSatelliteAnnouncerFor(toDomiaKey)) return true

	const domia = await getOwnDomia(toDomiaKey).catch(() => null)
	if (!domia) return false
	const features = resolveCoreBusFeatures(
		domia,
		normalizeRuntimeCapabilities(domia.runtimeCapabilities ?? {}),
	)
	return features.canPlayback
}

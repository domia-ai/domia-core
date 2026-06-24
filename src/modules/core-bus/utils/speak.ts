import { normalizeRuntimeCapabilities } from "@/setups/environment"
import { ttsAdapterToPcmChunks } from "@/modules/tts-engine"
import { type DomiaType, getOwnDomia } from "@/modules/core"
import { resolveCoreBusFeatures } from "./features"
import { playStreamedAudio } from "./playback"
import { registerStreamingSink, clearStreamingSink } from "./streaming-sink"
import { beginTurn } from "./turn-scope"
import {
	getSatelliteSinkFor,
	getSatelliteAnnouncerFor,
	getSatelliteDomiaKeys,
} from "./satellite-registry"
import { buildAudioUrl, registerAudioForServing } from "./audio"
import { mostRecentlyActiveSatellite } from "./presence-registry"
import { generateUuid, wrapPcmToWav, writeWavToTemp } from "@/utils"
import type {
	SpeakResultType,
	SpeakBroadcastResultType,
	ResolvedTtsEngineType,
} from "../types"

const renderTtsToServedUrl = async (
	domia: DomiaType,
	tts: NonNullable<ResolvedTtsEngineType>,
	text: string,
): Promise<string | null> => {
	const interactionId = generateUuid()
	const chunks: Buffer[] = []
	for await (const chunk of ttsAdapterToPcmChunks(domia, tts.adapter, text)) {
		chunks.push(chunk)
	}
	if (chunks.length === 0) return null
	const wav = wrapPcmToWav(
		Buffer.concat(chunks),
		tts.adapter.capabilities.sampleRate,
		tts.adapter.capabilities.channels,
		16,
	)
	const filePath = await writeWavToTemp(wav, interactionId, "announce")
	registerAudioForServing(interactionId, filePath)
	return buildAudioUrl(domia, interactionId)
}

export const renderAnnouncementUrl = async (
	domia: DomiaType,
	text: string,
): Promise<string | null> => {
	const trimmed = text.trim()
	if (!trimmed) return null
	const capabilities = normalizeRuntimeCapabilities(
		domia.runtimeCapabilities ?? {},
	)
	const features = resolveCoreBusFeatures(domia, capabilities)
	if (!features.tts) return null
	return renderTtsToServedUrl(domia, features.tts, trimmed)
}

const streamTtsTo = async (
	domia: DomiaType,
	features: ReturnType<typeof resolveCoreBusFeatures>,
	tts: NonNullable<ResolvedTtsEngineType>,
	text: string,
	useSink: boolean,
): Promise<void> => {
	const interactionId = generateUuid()
	const turn = beginTurn(domia.id, interactionId)
	if (useSink) {
		const sink = getSatelliteSinkFor(domia.domiaKey)
		if (sink) registerStreamingSink(interactionId, sink)
	}
	try {
		await playStreamedAudio(
			{ domia, features },
			ttsAdapterToPcmChunks(domia, tts.adapter, text),
			{
				interactionId,
				originDomiaKey: domia.domiaKey,
				aborted: () => turn.aborted(),
			},
			{
				sampleRate: tts.adapter.capabilities.sampleRate,
				channels: tts.adapter.capabilities.channels,
			},
		)
	} finally {
		if (useSink) clearStreamingSink(interactionId)
		turn.end()
	}
}

export const speak = async (
	domia: DomiaType,
	text: string,
): Promise<SpeakResultType> => {
	const trimmed = text.trim()
	if (!trimmed) return { delivered: false, target: "none" }

	const capabilities = normalizeRuntimeCapabilities(
		domia.runtimeCapabilities ?? {},
	)
	const features = resolveCoreBusFeatures(domia, capabilities)
	const tts = features.tts
	if (!tts) return { delivered: false, target: "none" }

	const announcer = getSatelliteAnnouncerFor(domia.domiaKey)
	const sink = getSatelliteSinkFor(domia.domiaKey)
	let delivered = false

	if (announcer) {
		const url = await renderTtsToServedUrl(domia, tts, trimmed)
		if (url) {
			announcer(url)
			delivered = true
		}
	}
	if (sink) {
		await streamTtsTo(domia, features, tts, trimmed, true)
		delivered = true
	}
	if (delivered) return { delivered: true, target: "satellite" }

	if (features.canPlayback) {
		await streamTtsTo(domia, features, tts, trimmed, false)
		return { delivered: true, target: "local" }
	}
	return { delivered: false, target: "none" }
}

export const speakActiveRoom = async (
	text: string,
): Promise<SpeakResultType> => {
	const domiaKey = mostRecentlyActiveSatellite()
	if (!domiaKey) return { delivered: false, target: "none" }
	const domia = await getOwnDomia(domiaKey).catch(() => null)
	if (!domia) return { delivered: false, target: "none" }
	return speak(domia, text)
}

export const speakBroadcast = async (
	text: string,
): Promise<SpeakBroadcastResultType> => {
	const delivered: string[] = []
	for (const domiaKey of getSatelliteDomiaKeys()) {
		const domia = await getOwnDomia(domiaKey).catch(() => null)
		if (!domia) continue
		const result = await speak(domia, text)
		if (result.delivered) delivered.push(domiaKey)
	}
	return { delivered }
}

import { normalizeRuntimeCapabilities } from "@/setups/environment"
import { ttsAdapterToPcmChunks } from "@/modules/tts-engine"
import { type DomiaType, getOwnDomia } from "@/modules/core"
import { resolveCoreBusFeatures } from "./features"
import { playStreamedAudio } from "./playback"
import { registerStreamingSink, clearStreamingSink } from "./streaming-sink"
import { beginTurn } from "./turn-scope"
import {
	getSatelliteSinkFor,
	getSatelliteDomiaKeys,
} from "./satellite-registry"
import { mostRecentlyActiveSatellite } from "./presence-registry"
import { generateUuid } from "@/utils"
import type { SpeakResultType, SpeakBroadcastResultType } from "../types"

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

	const sink = getSatelliteSinkFor(domia.domiaKey)
	const target: SpeakResultType["target"] = sink
		? "satellite"
		: features.canPlayback
			? "local"
			: "none"
	if (target === "none") return { delivered: false, target }

	const interactionId = generateUuid()
	const turn = beginTurn(domia.id, interactionId)
	if (sink) registerStreamingSink(interactionId, sink)
	try {
		await playStreamedAudio(
			{ domia, features },
			ttsAdapterToPcmChunks(domia, tts.adapter, trimmed),
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
		return { delivered: true, target }
	} finally {
		if (sink) clearStreamingSink(interactionId)
		turn.end()
	}
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

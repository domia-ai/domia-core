import { normalizeRuntimeCapabilities } from "@/setups/environment"
import { ttsAdapterToPcmChunks } from "@/modules/tts-engine"
import { type DomiaType, getOwnDomia, getHostedDomias } from "@/modules/core"
import { resolveCoreBusFeatures } from "./features"
import { playStreamedAudio } from "./playback"
import { registerStreamingSink, clearStreamingSink } from "./streaming-sink"
import { beginTurn } from "./turn-scope"
import {
	getSatelliteSinkFor,
	getSatelliteAnnouncerFor,
} from "./satellite-registry"
import { buildAudioUrl, registerAudioForServing } from "./audio"
import { mostRecentlyActiveSatellite } from "./presence-registry"
import {
	generateUuid,
	wrapPcmToWav,
	writeWavToTemp,
	wavFileToPcmChunks,
} from "@/utils"
import type {
	SpeakResultType,
	SpokenDomiaResultType,
	RenderedTtsType,
	ResolvedTtsEngineType,
	StreamingSinkFormatType,
} from "../types"

const renderTtsToServedUrl = async (
	domia: DomiaType,
	tts: NonNullable<ResolvedTtsEngineType>,
	text: string,
): Promise<RenderedTtsType | null> => {
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
	return {
		url: buildAudioUrl(domia, interactionId),
		id: interactionId,
		filePath,
	}
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
	const rendered = await renderTtsToServedUrl(domia, features.tts, trimmed)
	return rendered?.url ?? null
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

	const rendered = await renderTtsToServedUrl(domia, tts, trimmed)
	if (!rendered) return { delivered: false, target: "none" }

	const announcer = getSatelliteAnnouncerFor(domia.domiaKey)
	const sink = getSatelliteSinkFor(domia.domiaKey)
	const format: StreamingSinkFormatType = {
		sampleRate: tts.adapter.capabilities.sampleRate,
		channels: tts.adapter.capabilities.channels === 2 ? 2 : 1,
	}
	const audio = { audioId: rendered.id, audioPath: rendered.filePath }

	if (announcer) {
		if (!rendered.url) return { delivered: false, target: "none", ...audio }
		announcer(rendered.url)
		return { delivered: true, target: "satellite", ...audio }
	}
	if (sink) {
		await streamAudioFileTo(domia, features, rendered.filePath, format, true)
		return { delivered: true, target: "satellite", ...audio }
	}
	if (features.canPlayback) {
		await streamAudioFileTo(domia, features, rendered.filePath, format, false)
		return { delivered: true, target: "local", ...audio }
	}
	return { delivered: false, target: "none", ...audio }
}

const wavFormat = (wav: Buffer): StreamingSinkFormatType => {
	if (wav.length >= 28 && wav.toString("ascii", 0, 4) === "RIFF") {
		const channels = wav.readUInt16LE(22) === 2 ? 2 : 1
		const sampleRate = wav.readUInt32LE(24) || 16000
		return { sampleRate, channels }
	}
	return { sampleRate: 16000, channels: 1 }
}

const streamAudioFileTo = async (
	domia: DomiaType,
	features: ReturnType<typeof resolveCoreBusFeatures>,
	filePath: string,
	format: StreamingSinkFormatType,
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
			wavFileToPcmChunks(filePath),
			{
				interactionId,
				originDomiaKey: domia.domiaKey,
				aborted: () => turn.aborted(),
			},
			format,
		)
	} finally {
		if (useSink) clearStreamingSink(interactionId)
		turn.end()
	}
}

export const announceAudio = async (
	domia: DomiaType,
	wav: Buffer,
): Promise<SpeakResultType> => {
	if (wav.length === 0) return { delivered: false, target: "none" }

	const capabilities = normalizeRuntimeCapabilities(
		domia.runtimeCapabilities ?? {},
	)
	const features = resolveCoreBusFeatures(domia, capabilities)
	const announcer = getSatelliteAnnouncerFor(domia.domiaKey)
	const sink = getSatelliteSinkFor(domia.domiaKey)
	const format = wavFormat(wav)

	const interactionId = generateUuid()
	const filePath = await writeWavToTemp(wav, interactionId, "announce")

	let delivered = false
	if (announcer) {
		const url = buildAudioUrl(domia, interactionId)
		if (url) {
			registerAudioForServing(interactionId, filePath)
			announcer(url)
			delivered = true
		}
	}
	if (!delivered && sink) {
		await streamAudioFileTo(domia, features, filePath, format, true)
		delivered = true
	}
	if (delivered)
		return {
			delivered: true,
			target: "satellite",
			audioId: interactionId,
			audioPath: filePath,
		}

	if (features.canPlayback) {
		await streamAudioFileTo(domia, features, filePath, format, false)
		return {
			delivered: true,
			target: "local",
			audioId: interactionId,
			audioPath: filePath,
		}
	}
	return {
		delivered: false,
		target: "none",
		audioId: interactionId,
		audioPath: filePath,
	}
}

export const speakActiveRoom = async (
	text: string,
): Promise<SpokenDomiaResultType | null> => {
	const domiaKey = mostRecentlyActiveSatellite()
	if (!domiaKey) return null
	const domia = await getOwnDomia(domiaKey).catch(() => null)
	if (!domia) return null
	return { domia, result: await speak(domia, text) }
}

export const speakBroadcast = async (
	text: string,
): Promise<SpokenDomiaResultType[]> => {
	const out: SpokenDomiaResultType[] = []
	for (const { domiaKey } of await getHostedDomias()) {
		const domia = await getOwnDomia(domiaKey).catch(() => null)
		if (!domia) continue
		out.push({ domia, result: await speak(domia, text) })
	}
	return out
}

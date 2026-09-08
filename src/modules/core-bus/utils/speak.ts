import { normalizeRuntimeCapabilities } from "@/setups/environment"
import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { cachedTtsPcmChunks } from "@/modules/tts-engine"
import { type DomiaType, safeOwnDomia, getHostedDomias } from "@/modules/core"
import { startFollowUpRecording } from "@/modules/audio-capture"
import { playFeedbackSound } from "@/modules/feedback-sounds"
import { resolveCoreBusFeatures } from "./features"
import { playStreamedAudio } from "./playback"
import { registerStreamingSink, clearStreamingSink } from "./streaming-sink"
import { beginTurn, beginTurnIfIdle, getActiveTurn } from "./turn-scope"
import { isDomiaBusy } from "./availability"
import { tryBeginRecording, endRecording } from "./recording-guard"
import {
	getSatelliteSinkFor,
	getSatelliteAnnouncerFor,
	getSatelliteControl,
} from "./satellite-registry"
import { buildAudioUrl, registerAudioForServing } from "./audio"
import { mostRecentlyActiveSatellite, getPresence } from "./presence-registry"
import {
	generateUuid,
	wrapPcmToWav,
	writeWavToTemp,
	wavFileToPcmChunks,
	domiaBusLogger,
} from "@/utils"
import type {
	SpeakResultType,
	SpeakOptionsType,
	SpeakPolitenessType,
	SpeakAndListenResultType,
	SpokenDomiaResultType,
	RenderedTtsType,
	ResolvedTtsEngineType,
	StreamingSinkFormatType,
	SpeakTargetType,
} from "../types"

const SPEAK_WAIT_FOR_TURN_MS = 15000

const renderTtsToServedUrl = async (
	domia: DomiaType,
	tts: NonNullable<ResolvedTtsEngineType>,
	text: string,
): Promise<RenderedTtsType | null> => {
	const interactionId = generateUuid()
	const chunks: Buffer[] = []
	for await (const chunk of cachedTtsPcmChunks(domia, tts.adapter, text)) {
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

export const resolveSpeakDelivery = (
	domiaKey: string,
	target?: SpeakTargetType,
): {
	announcer: ReturnType<typeof getSatelliteAnnouncerFor>
	sink: ReturnType<typeof getSatelliteSinkFor>
	allowLocal: boolean
} => {
	if (target?.kind === "local")
		return { announcer: null, sink: null, allowLocal: true }
	if (target?.kind === "satellite")
		return {
			announcer: getSatelliteAnnouncerFor(domiaKey, target.satelliteId),
			sink: getSatelliteSinkFor(domiaKey, target.satelliteId),
			allowLocal: false,
		}
	return {
		announcer: getSatelliteAnnouncerFor(domiaKey),
		sink: getSatelliteSinkFor(domiaKey),
		allowLocal: true,
	}
}

const formatOf = (
	tts: NonNullable<ResolvedTtsEngineType>,
): StreamingSinkFormatType => ({
	sampleRate: tts.adapter.capabilities.sampleRate,
	channels: tts.adapter.capabilities.channels === 2 ? 2 : 1,
})

export const speak = async (
	domia: DomiaType,
	text: string,
	target?: SpeakTargetType,
	options?: SpeakOptionsType,
): Promise<SpeakResultType> => {
	const trimmed = text.trim()
	if (!trimmed) return { delivered: false, target: "none" }
	const politeness = options?.politeness ?? "steal"

	const { announcer, sink, allowLocal } = resolveSpeakDelivery(
		domia.domiaKey,
		target,
	)
	if (target?.kind === "satellite" && !announcer && !sink)
		return { delivered: false, target: "none" }

	const capabilities = normalizeRuntimeCapabilities(
		domia.runtimeCapabilities ?? {},
	)
	const features = resolveCoreBusFeatures(domia, capabilities)
	const tts = features.tts
	if (!tts) return { delivered: false, target: "none" }
	if (!announcer && !sink && !(allowLocal && features.canPlayback))
		return { delivered: false, target: "none" }

	if (politeness === "polite" && isDomiaBusy(domia.id, domia.domiaKey))
		return { delivered: false, target: "none", reason: "busy" }

	const rendered = await renderTtsToServedUrl(domia, tts, trimmed)
	if (!rendered) return { delivered: false, target: "none" }
	const format = formatOf(tts)
	const audio = { audioId: rendered.id, audioPath: rendered.filePath }

	if (announcer) {
		if (!rendered.url) return { delivered: false, target: "none", ...audio }
		if (politeness === "polite" && isDomiaBusy(domia.id, domia.domiaKey))
			return { delivered: false, target: "none", reason: "busy", ...audio }
		announcer(rendered.url)
		return { delivered: true, target: "satellite", ...audio }
	}
	if (sink) {
		const played = await streamAudioFileTo(
			domia,
			features,
			rendered.filePath,
			format,
			sink,
			politeness,
		)
		return played
			? { delivered: true, target: "satellite", ...audio }
			: { delivered: false, target: "none", reason: "busy", ...audio }
	}
	if (allowLocal && features.canPlayback) {
		const played = await streamAudioFileTo(
			domia,
			features,
			rendered.filePath,
			format,
			null,
			politeness,
		)
		return played
			? { delivered: true, target: "local", ...audio }
			: { delivered: false, target: "none", reason: "busy", ...audio }
	}
	return { delivered: false, target: "none", ...audio }
}

const openLocalListenWindow = async (domia: DomiaType): Promise<void> => {
	if (!tryBeginRecording(domia.id)) {
		domiaBusLogger.warn(
			"🎙️ converse listen window skipped — recording already in progress",
			{ domiaId: domia.id },
		)
		return
	}
	try {
		const recording = await startFollowUpRecording(domia)
		if (!recording) return
		publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath: recording.filePath,
			originDomiaKey: domia.domiaKey,
			speechEndAt: recording.speechEndAt ?? undefined,
			liveVoice: true,
		})
	} catch (err) {
		domiaBusLogger.warn("🎙️ converse listen window failed", {
			domiaId: domia.id,
			err,
		})
	} finally {
		endRecording(domia.id)
	}
}

const converseSatelliteFor = (
	domiaKey: string,
	target?: SpeakTargetType,
): string | null => {
	if (target?.kind === "local") return null
	const entry = getPresence(domiaKey)
	if (!entry) return null
	const candidates = entry.satellites.filter(
		(s) =>
			s.connected &&
			s.capabilities.canFollowUp &&
			(target?.kind !== "satellite" || s.satelliteId === target.satelliteId),
	)
	if (candidates.length === 0) return null
	candidates.sort((a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0))
	return candidates[0].satelliteId
}

export const speakAndListen = async (
	domia: DomiaType,
	text: string,
	target?: SpeakTargetType,
): Promise<SpeakAndListenResultType> => {
	const trimmed = text.trim()
	if (!trimmed) return { delivered: false, target: "none", listening: false }
	if (isDomiaBusy(domia.id, domia.domiaKey))
		return {
			delivered: false,
			target: "none",
			listening: false,
			reason: "busy",
		}

	const satelliteId = converseSatelliteFor(domia.domiaKey, target)
	const control = satelliteId
		? getSatelliteControl(domia.domiaKey, satelliteId)
		: null
	if (satelliteId && control?.startConversation) {
		const url = await renderAnnouncementUrl(domia, trimmed)
		if (!url) return { delivered: false, target: "none", listening: false }
		if (isDomiaBusy(domia.id, domia.domiaKey))
			return {
				delivered: false,
				target: "none",
				listening: false,
				reason: "busy",
			}
		control.startConversation(url)
		return { delivered: true, target: "satellite-converse", listening: true }
	}

	const capabilities = normalizeRuntimeCapabilities(
		domia.runtimeCapabilities ?? {},
	)
	const features = resolveCoreBusFeatures(domia, capabilities)
	const { announcer, sink, allowLocal } = resolveSpeakDelivery(
		domia.domiaKey,
		target,
	)
	const localConverse =
		allowLocal &&
		!announcer &&
		!sink &&
		features.canPlayback &&
		capabilities.record &&
		(domia.wakeWordConfig?.followUpWindowMs ?? 0) > 0

	const spoken = await speak(domia, trimmed, target, { politeness: "polite" })
	const audio = { audioId: spoken.audioId, audioPath: spoken.audioPath }
	if (!spoken.delivered)
		return {
			delivered: false,
			target: "none",
			listening: false,
			reason: spoken.reason,
			...audio,
		}
	if (localConverse && spoken.target === "local") {
		playFeedbackSound(domia, "ack")
		void openLocalListenWindow(domia)
		return { delivered: true, target: "local", listening: true, ...audio }
	}
	domiaBusLogger.info(
		`📢 converse degraded to announce (${spoken.target}) — no follow-up capability`,
		{ domiaKey: domia.domiaKey },
	)
	return {
		delivered: true,
		target: spoken.target === "satellite" ? "satellite-announce" : "local",
		listening: false,
		reason: "no-follow-up-capability",
		...audio,
	}
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
	sink: ReturnType<typeof getSatelliteSinkFor>,
	politeness: SpeakPolitenessType = "steal",
): Promise<boolean> => {
	const interactionId = generateUuid()
	if (politeness === "steal") {
		const active = getActiveTurn(domia.id)
		if (active && !active.aborted()) {
			await Promise.race([
				active.settled,
				new Promise((r) => setTimeout(r, SPEAK_WAIT_FOR_TURN_MS)),
			])
		}
	}
	if (politeness === "polite" && isDomiaBusy(domia.id, domia.domiaKey))
		return false
	const turn =
		politeness === "polite"
			? beginTurnIfIdle(domia.id, interactionId)
			: beginTurn(domia.id, interactionId)
	if (!turn) return false
	if (sink) registerStreamingSink(interactionId, sink)
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
		if (sink) clearStreamingSink(interactionId)
		turn.end()
	}
	return true
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
		await streamAudioFileTo(domia, features, filePath, format, sink)
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
		await streamAudioFileTo(domia, features, filePath, format, null)
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
	const domia = await safeOwnDomia(domiaKey, "speak")
	if (!domia) return null
	return { domia, result: await speak(domia, text) }
}

export const speakBroadcast = async (
	text: string,
): Promise<SpokenDomiaResultType[]> => {
	const out: SpokenDomiaResultType[] = []
	for (const { domiaKey } of await getHostedDomias()) {
		const domia = await safeOwnDomia(domiaKey, "speak")
		if (!domia) continue
		out.push({ domia, result: await speak(domia, text) })
	}
	return out
}

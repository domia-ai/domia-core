import { type DomiaType } from "@/modules/core"
import { playAudio } from "@/modules/audio-playback"
import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import { domiaBusLogger } from "@/utils"
import type {
	FeedbackSoundKindType,
	AcknowledgeEndpointOptsType,
} from "../types"

const resolveSound = (
	domia: DomiaType,
	kind: FeedbackSoundKindType,
): string | null => {
	const config = domia.audioPlaybackConfig
	if (!config?.feedbackSoundsEnabled) return null
	const enabled = {
		ack: config.ackSoundEnabled,
		error: config.errorSoundEnabled,
		done: config.doneSoundEnabled,
		thinking: config.thinkingSoundEnabled,
		endpoint: config.endpointSoundEnabled,
	}[kind]
	if (!enabled) return null
	const path = {
		ack: config.ackSoundPath,
		error: config.errorSoundPath,
		done: config.doneSoundPath,
		thinking: config.thinkingSoundPath,
		endpoint: config.endpointSoundPath,
	}[kind]
	return path?.trim() ? path : null
}

export const playFeedbackSound = (
	domia: DomiaType,
	kind: FeedbackSoundKindType,
): void => {
	const path = resolveSound(domia, kind)
	if (!path) return
	void playAudio(domia, path).catch((err) =>
		domiaBusLogger.warn(`🔔 feedback sound (${kind}) failed`, {
			domiaId: domia.id,
			err,
		}),
	)
}

const acknowledged = new Set<string>()
const MAX_ACKNOWLEDGED = 512

export const acknowledgeEndpoint = (
	domia: DomiaType,
	interactionId: string,
	opts: AcknowledgeEndpointOptsType = {},
): boolean => {
	if (acknowledged.has(interactionId)) return false
	acknowledged.add(interactionId)
	if (acknowledged.size > MAX_ACKNOWLEDGED) {
		const oldest = acknowledged.values().next().value
		if (oldest !== undefined) acknowledged.delete(oldest)
	}
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.ENDPOINT_ACCEPTED,
		interactionId,
		originDomiaKey: opts.originDomiaKey ?? domia.domiaKey,
		sinceSpeechEndMs: opts.sinceSpeechEndMs,
	})
	if (opts.playSound !== false) playFeedbackSound(domia, "endpoint")
	return true
}

export const wasEndpointAcknowledged = (interactionId: string): boolean =>
	acknowledged.has(interactionId)

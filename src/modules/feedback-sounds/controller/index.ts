import { type DomiaType } from "@/modules/core"
import { playAudio } from "@/modules/audio-playback"
import { domiaBusLogger } from "@/utils"
import type { FeedbackSoundKindType } from "../types"

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
	}[kind]
	if (!enabled) return null
	const path = {
		ack: config.ackSoundPath,
		error: config.errorSoundPath,
		done: config.doneSoundPath,
		thinking: config.thinkingSoundPath,
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

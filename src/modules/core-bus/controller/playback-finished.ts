import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, toError } from "@/utils"
import { startFollowUpRecording } from "@/modules/audio-capture"
import { playFeedbackSound } from "@/modules/feedback-sounds"
import { tryBeginRecording, endRecording } from "../utils"
import type { CoreBusContextType, PlaybackFinishedPayloadType } from "../types"

export const handlePlaybackFinished = async (
	ctx: CoreBusContextType,
	payload: PlaybackFinishedPayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const { capabilities } = features
	const domiaId = domia.id

	if (payload?.status !== "completed" || payload?.playedLocally !== true) return
	if (payload?.liveVoice !== true) return

	const windowMs = domia.wakeWordConfig?.followUpWindowMs ?? 0
	const willFollowUp =
		capabilities.record && capabilities.wakeword && windowMs > 0
	if (!willFollowUp) {
		playFeedbackSound(domia, "done")
		return
	}

	if (!tryBeginRecording(domiaId)) {
		domiaBusLogger.warn(
			`🚫 follow-up window skipped — recording already in progress for ${domiaId}`,
		)
		return
	}

	try {
		const recording = await startFollowUpRecording(domia)
		if (!recording) {
			playFeedbackSound(domia, "done")
			return
		}
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath: recording.filePath,
			originDomiaKey: domia.domiaKey,
			speechEndAt: recording.speechEndAt ?? undefined,
			liveVoice: true,
		})
	} catch (err) {
		domiaBusLogger.error("follow-up recording failed", { domiaId, err })
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, {
			error: toError(err),
		})
	} finally {
		endRecording(domiaId)
	}
}

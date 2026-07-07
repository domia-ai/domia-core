import { domiaBusLogger, setTraceContext, toError } from "@/utils"
import {
	notifyInteractionFailed,
	setInteractionAudio,
	completeInteraction,
	getInteractionRuntime,
	deliverLocalPlayback,
	deliverDelegatedPlayback,
} from "../utils"
import { getOrCreateInteractionId } from "@/modules/session-manager"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import type { CoreBusContextType, TtsDonePayloadType } from "../types"

export const handleTtsDone = async (
	ctx: CoreBusContextType,
	payload: TtsDonePayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const { canPlayback } = features
	const domiaId = domia.id
	const { filePath, reply, transcript, originDomiaKey, audioUrl, liveVoice } =
		payload

	const audioDelivery = payload.interactionId
		? getInteractionRuntime(payload.interactionId)?.audioDelivery
		: undefined
	// streaming-sink / audio-url / none: the producer (satellite/url) owns playback, so TTS_DONE is the
	// terminal ("dispatched"). local-playback / delegated complete later at PLAYBACK_FINISHED (§4.3).
	const dispatchedTerminal =
		audioDelivery === "streaming-sink" ||
		audioDelivery === "audio-url" ||
		audioDelivery === "none"
	if (payload.interactionId) {
		setInteractionAudio(payload.interactionId, {
			ttsFilePath: filePath,
			audioUrl,
		})
		if (dispatchedTerminal) {
			completeInteraction(payload.interactionId, {
				result: { transcript, reply },
			})
		}
	}
	if (!filePath && !audioUrl) {
		domiaBusLogger.info(
			`🗣️ TTS_DONE: no filePath/audioUrl — already streamed, skipping handler`,
			{ domiaId, interactionId: payload.interactionId },
		)
		return
	}
	if (dispatchedTerminal) {
		domiaBusLogger.info(
			`🗣️ TTS_DONE: audioDelivery=${audioDelivery} — producer delivers, skipping local playback`,
			{ domiaId, interactionId: payload.interactionId },
		)
		return
	}

	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
		},
	)
	if (!interactionId) return
	setTraceContext({ interactionId, originDomiaKey })

	try {
		if (canPlayback) {
			await deliverLocalPlayback(ctx, interactionId, payload)
			return
		}
		await deliverDelegatedPlayback(ctx, interactionId, payload)
	} catch (err) {
		domiaBusLogger.error("TTS_DONE: playback or delegate failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
			error: toError(err),
			step: "playback",
			liveVoice,
		})
	}
}

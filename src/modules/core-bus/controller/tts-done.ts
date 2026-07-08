import { domiaBusLogger, setTraceContext, toError } from "@/utils"
import {
	notifyInteractionFailed,
	setInteractionAudio,
	completeInteraction,
	getInteractionRuntime,
	resolveDeliverySink,
	emitTerminalCompletion,
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
		? getInteractionRuntime(payload.interactionId)?.delivery.audioDelivery
		: undefined
	const sink = resolveDeliverySink(audioDelivery, canPlayback)
	const dispatchedTerminal = sink.terminalAt === "dispatch"
	if (payload.interactionId) {
		setInteractionAudio(payload.interactionId, {
			ttsFilePath: filePath,
			audioUrl,
		})
		if (dispatchedTerminal) {
			completeInteraction(payload.interactionId, {
				result: { transcript, reply },
			})
			await emitTerminalCompletion(
				payload.interactionId,
				originDomiaKey ?? "",
				{
					status: "ok",
				},
			)
		}
	}
	if (!filePath && !audioUrl) {
		domiaBusLogger.info(
			`🗣️ TTS_DONE: no filePath/audioUrl — already streamed, skipping handler`,
			{ domiaId, interactionId: payload.interactionId },
		)
		return
	}
	if (dispatchedTerminal || !sink.deliver) {
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
		await sink.deliver(ctx, interactionId, payload)
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

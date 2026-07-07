import { domiaBusLogger } from "@/utils"
import {
	notifyInteractionFailed,
	failInteraction,
	persistTerminal,
} from "../utils"
import { INTERACTION_STATUS_ENUM } from "@/db"
import { playFeedbackSound } from "@/modules/feedback-sounds"
import type {
	AudioErrorPayloadType,
	CapabilityMissingPayloadType,
	CoreBusContextType,
	InteractionFailedPayloadType,
} from "../types"

export const handleAudioError = (
	ctx: CoreBusContextType,
	payload: AudioErrorPayloadType,
): void => {
	domiaBusLogger.error("❌ AUDIO_ERROR", {
		domiaId: ctx.domia.id,
		error: payload.error,
	})
}

export const handleCapabilityMissing = (
	ctx: CoreBusContextType,
	payload: CapabilityMissingPayloadType,
): void => {
	const domiaId = ctx.domia.id
	const { capability, interactionId, originDomiaKey, responseType } = payload
	domiaBusLogger.error("❌ CAPABILITY_MISSING", { domiaId, capability })
	if (!interactionId) return
	notifyInteractionFailed(ctx, {
		interactionId,
		originDomiaKey,
		responseType,
		error: `Capability missing: ${capability}`,
		step: "capability",
	})
}

export const handleInteractionFailed = (
	ctx: CoreBusContextType,
	payload: InteractionFailedPayloadType,
): void => {
	domiaBusLogger.error("❌ INTERACTION_FAILED", {
		domiaId: ctx.domia.id,
		interactionId: payload.interactionId,
		step: payload.step,
		error: payload.error,
	})
	if (payload.interactionId) {
		void persistTerminal(
			payload.interactionId,
			INTERACTION_STATUS_ENUM.FAILED,
			{
				errorStep: payload.step,
				errorMessage: payload.error,
				errorCode: payload.errorCode,
			},
		)
	}
	failInteraction(payload.interactionId, payload.error, payload.step)
	if (payload.liveVoice) playFeedbackSound(ctx.domia, "error")
}

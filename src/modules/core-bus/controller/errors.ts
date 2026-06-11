import { domiaBusLogger, toError } from "@/utils"
import { notifyInteractionFailed, rejectPending } from "../utils"
import { INTERACTION_STATUS_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import { updateInteraction } from "@/modules/session-manager"
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
		void updateInteraction({
			id: payload.interactionId,
			status: INTERACTION_STATUS_ENUM.FAILED,
			errorStep: payload.step ?? null,
			errorMessage: payload.error,
		}).catch((err) =>
			domiaBusLogger.warn("⚠️ failed to persist interaction failure", {
				interactionId: payload.interactionId,
				err,
			}),
		)
	}
	if (payload.responseType === RESPONSE_TYPE_ENUM.TEXT) {
		rejectPending(payload.interactionId, toError(payload.error))
	}
}

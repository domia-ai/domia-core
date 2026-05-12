import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, toError } from "@/utils"
import { rejectPending } from "./pending-requests"
import { MQTT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import type {
	CoreBusContextType,
	NotifyAudioFallbackArgsType,
	NotifyInteractionFailedArgsType,
} from "../types"

export const notifyInteractionFailed = (
	ctx: CoreBusContextType,
	args: NotifyInteractionFailedArgsType,
): void => {
	const { domia, mqttClient } = ctx
	const { interactionId, originDomiaKey, responseType, error, step } = args
	const err = toError(error)
	const payload = {
		interactionId,
		originDomiaKey,
		responseType,
		error: err.message,
		step,
	}
	publishToDomiaBus(
		ctx.domia.id,
		DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
		payload,
	)
	if (originDomiaKey && originDomiaKey !== domia.domiaKey) {
		mqttClient?.publish(
			`domia/${originDomiaKey}/${MQTT_TYPE_ENUM.LOCAL}/${DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED}`,
			JSON.stringify(payload),
		)
	}
	if (responseType === RESPONSE_TYPE_ENUM.TEXT) {
		rejectPending(interactionId, err)
	}
}

export const notifyAudioFallback = (
	ctx: CoreBusContextType,
	args: NotifyAudioFallbackArgsType,
): void => {
	const { interactionId, originDomiaKey, reason, error, reply } = args
	const err = toError(error)
	domiaBusLogger.warn(
		`⚠️ audio fallback (${reason}) — interaction continues without playback`,
		{
			domiaId: ctx.domia.id,
			interactionId,
			reason,
			error: err.message,
			...(reply ? { replyPreview: reply.slice(0, 200) } : {}),
		},
	)
	publishToDomiaBus(ctx.domia.id, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
		interactionId,
		originDomiaKey,
	})
}

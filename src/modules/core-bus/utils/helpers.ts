import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { toError } from "@/utils"
import { rejectPending } from "./pending-requests"
import { MQTT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import type {
	CoreBusContextType,
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

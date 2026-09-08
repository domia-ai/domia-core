import { type DomiaType } from "@/modules/core"
import { type LoggerType, type MeshControlRejectReasonType } from "@/utils"
import { type MQTT_EVENT_ENUM } from "@/setups/mqtt/constants"

export type WarnDropArgsType = {
	identity: string
	reason: MeshControlRejectReasonType
	label: string
	text: string
	logger: LoggerType
}

export type handleMqttMessageArgsType = {
	topic: string
	message: Buffer
	logger: LoggerType
	domia: DomiaType
}

export type DispatchMeshEventArgsType = {
	eventName: MQTT_EVENT_ENUM
	payload: Record<string, unknown>
	topicIdentity: string
	mqttType: string | undefined
	logger: LoggerType
}

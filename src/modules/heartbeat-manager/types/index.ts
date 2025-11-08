import { MqttClient } from "mqtt"

import { DomiaType } from "@/modules/core"

export type SendHeartbeatArgsType = {
	domia: DomiaType
	mqttClient: MqttClient | null
}

export type ReceiveHeartbeatArgsType = {
	domia: DomiaType
}

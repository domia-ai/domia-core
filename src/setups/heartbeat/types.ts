import { MqttClient } from "mqtt"

import { type DomiaType } from "@/modules/core"

export type SetupHeartbeatArgsType = {
	domia: DomiaType
	intervalSeconds?: number
	mqttClient: MqttClient | null
}

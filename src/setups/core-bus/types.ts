import type { MqttClient } from "mqtt"
import { type DomiaType } from "@/modules/core"
import { type RuntimeCapabilitiesType } from "../environment"

export type CoreBusArgsType = {
	domia: DomiaType
	runtimeCapabilities: RuntimeCapabilitiesType
	mqttClient: MqttClient | null
}

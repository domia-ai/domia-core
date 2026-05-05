import type { MqttClient } from "mqtt"
import { type DomiaType } from "@/modules/core"
import { type RuntimeCapabilitiesType } from "@/setups/environment"

export type CoreBusContextType = {
	domia: DomiaType
	runtimeCapabilities: RuntimeCapabilitiesType
	mqttClient: MqttClient | null
}

export type AudioReadyPayloadType = {
	filePath?: string
	audioUrl?: string
	originDomiaKey?: string
	interactionId?: string
}

export type SttDonePayloadType = {
	transcript: string
	interactionId?: string
	originDomiaKey?: string
	responseType?: string
}

export type LlmDonePayloadType = {
	reply: string
	interactionId?: string
	originDomiaKey?: string
	responseType?: string
}

export type TtsDonePayloadType = {
	filePath?: string
	interactionId?: string
	originDomiaKey?: string
	audioUrl?: string
}

export type AudioErrorPayloadType = {
	error: Error
}

export type CapabilityMissingPayloadType = {
	capability: string
	interactionId?: string
	originDomiaKey?: string
	responseType?: string
}

export type InteractionFailedPayloadType = {
	interactionId: string
	originDomiaKey?: string
	responseType?: string
	error: string
	step?: string
}

export type NotifyInteractionFailedArgsType = {
	interactionId: string
	originDomiaKey?: string
	responseType?: string
	error: Error | string
	step?: string
}

export type ServeEntryType = {
	filePath: string
	createdAt: number
}

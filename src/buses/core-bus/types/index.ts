import { type CapabilityEnumType } from "@/db"
import { DOMIA_EVENT_BUS_ENUM } from "../constants"

export type DomiaEventBusPayloadMapType = {
	[DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED]: { reply: string }
	[DOMIA_EVENT_BUS_ENUM.AUDIO_READY]: {
		filePath?: string
		audioUrl?: string
		originDomiaKey?: string
		interactionId?: string
	}
	[DOMIA_EVENT_BUS_ENUM.STT_DONE]: {
		transcript: string
		interactionId?: string
		originDomiaKey?: string
		responseType?: string
	}
	[DOMIA_EVENT_BUS_ENUM.LLM_DONE]: {
		reply: string
		interactionId?: string
		originDomiaKey?: string
		responseType?: string
	}
	[DOMIA_EVENT_BUS_ENUM.TTS_DONE]: {
		filePath?: string
		interactionId?: string
		originDomiaKey?: string
		audioUrl?: string
	}
	[DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR]: { error: Error }
	[DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING]: {
		capability: CapabilityEnumType
		interactionId?: string
		originDomiaKey?: string
		responseType?: string
	}
	[DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED]: {
		interactionId: string
		originDomiaKey?: string
		responseType?: string
		error: string
		step?: string
	}
}

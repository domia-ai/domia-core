import { type CapabilityEnumType } from "@/db"
import { DOMIA_EVENT_BUS_ENUM } from "../constants"

export type PlaybackStatusType = "completed" | "interrupted" | "failed"

export type DomiaBusEnvelopeType = {
	interactionId: string
	originDomiaKey?: string
	traceId?: string
	liveVoice?: boolean
}

export type DomiaEventBusPayloadMapType = {
	[DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED]: { reply: string }
	[DOMIA_EVENT_BUS_ENUM.AUDIO_READY]: {
		filePath?: string
		audioUrl?: string
		originDomiaKey?: string
		interactionId?: string
		responseType?: string
		speechEndAt?: number
		endpointDelayMs?: number
		endpointDebounceMs?: number
		liveVoice?: boolean
		traceId?: string
	}
	[DOMIA_EVENT_BUS_ENUM.STT_DONE]: DomiaBusEnvelopeType & {
		transcript: string
		responseType?: string
		alreadyHandled?: boolean
		prestartedTokens?: AsyncIterable<string>
		prestartedPrompt?: string
		prestartedExecutorKey?: string
		prestartedRelease?: () => void
		prestartedFirstUnitText?: string
		prestartedFirstUnitPcm?: Promise<Buffer | null>
		speechEndAt?: number
		endpointDelayMs?: number
		endpointDebounceMs?: number
	}
	[DOMIA_EVENT_BUS_ENUM.PROCESSING_STARTED]: DomiaBusEnvelopeType
	[DOMIA_EVENT_BUS_ENUM.LLM_DONE]: DomiaBusEnvelopeType & {
		reply: string
		transcript?: string
		responseType?: string
		alreadyStreamed?: boolean
		speechEndAt?: number
	}
	[DOMIA_EVENT_BUS_ENUM.TTS_DONE]: DomiaBusEnvelopeType & {
		filePath?: string
		reply?: string
		transcript?: string
		audioUrl?: string
	}
	[DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED]: DomiaBusEnvelopeType & {
		playedLocally?: boolean
	}
	[DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED]: DomiaBusEnvelopeType & {
		status?: PlaybackStatusType
		playedLocally?: boolean
		positionMs?: number
	}
	[DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR]: { error: Error }
	[DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING]: {
		capability: CapabilityEnumType
		interactionId?: string
		originDomiaKey?: string
		responseType?: string
	}
	[DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED]: DomiaBusEnvelopeType & {
		responseType?: string
		error: string
		step?: string
		errorCode?: string
	}
}

import { type CapabilityEnumType } from "@/db"
import { DOMIA_EVENT_BUS_ENUM } from "../constants"

export type PlaybackStatusType = "completed" | "interrupted" | "failed"

export type DomiaEventBusPayloadMapType = {
	[DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED]: { reply: string }
	[DOMIA_EVENT_BUS_ENUM.AUDIO_READY]: {
		filePath?: string
		audioUrl?: string
		originDomiaKey?: string
		interactionId?: string
		speechEndAt?: number
		liveVoice?: boolean
		traceId?: string
	}
	[DOMIA_EVENT_BUS_ENUM.STT_DONE]: {
		transcript: string
		interactionId?: string
		originDomiaKey?: string
		responseType?: string
		alreadyHandled?: boolean
		prestartedTokens?: AsyncIterable<string>
		prestartedPrompt?: string
		prestartedExecutorKey?: string
		prestartedRelease?: () => void
		speechEndAt?: number
		liveVoice?: boolean
		traceId?: string
	}
	[DOMIA_EVENT_BUS_ENUM.PROCESSING_STARTED]: {
		interactionId?: string
		originDomiaKey?: string
		liveVoice?: boolean
		traceId?: string
	}
	[DOMIA_EVENT_BUS_ENUM.LLM_DONE]: {
		reply: string
		transcript?: string
		interactionId?: string
		originDomiaKey?: string
		responseType?: string
		alreadyStreamed?: boolean
		speechEndAt?: number
		liveVoice?: boolean
		traceId?: string
	}
	[DOMIA_EVENT_BUS_ENUM.TTS_DONE]: {
		filePath?: string
		reply?: string
		transcript?: string
		interactionId?: string
		originDomiaKey?: string
		audioUrl?: string
		liveVoice?: boolean
		traceId?: string
	}
	[DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED]: {
		interactionId?: string
		originDomiaKey?: string
		traceId?: string
	}
	[DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED]: {
		interactionId?: string
		originDomiaKey?: string
		status?: PlaybackStatusType
		playedLocally?: boolean
		liveVoice?: boolean
		traceId?: string
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
		liveVoice?: boolean
	}
}

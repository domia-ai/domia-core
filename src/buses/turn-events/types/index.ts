import type { PlaybackStatusType } from "@/buses/core-bus/types"
import { DOMIA_TURN_EVENT_ENUM } from "../constants"

export type TurnEventInputSourceType =
	| "local"
	| "satellite"
	| "http"
	| "grpc"
	| "console"
	| "announcement"
	| "scheduled"

export type TurnEventToolStatusType =
	| "ok"
	| "failed"
	| "timeout"
	| "cancelled"
	| "denied"

export type TurnEventEnvelopeType = {
	interactionId: string
	originDomiaKey: string
	executorDomiaKey?: string
	satelliteId?: string
	traceId?: string
}

export type TurnStageNameType =
	| "stt"
	| "llm"
	| "tool"
	| "tts"
	| "playback"
	| "satellite"
	| "skills"
	| "context"

export type TurnEventBodyMapType = {
	[DOMIA_TURN_EVENT_ENUM.TURN_STARTED]: {
		inputType: "voice" | "text"
		source: TurnEventInputSourceType
	}
	[DOMIA_TURN_EVENT_ENUM.ENDPOINT_ACCEPTED]: {
		sinceSpeechEndMs?: number
	}
	[DOMIA_TURN_EVENT_ENUM.STT_FINAL]: {
		transcript: string
		sttMs?: number
		speculative?: boolean
	}
	[DOMIA_TURN_EVENT_ENUM.STAGE_STARTED]: {
		stageName: TurnStageNameType
	}
	[DOMIA_TURN_EVENT_ENUM.STAGE_DONE]: {
		stageName: TurnStageNameType
		elapsedMs: number
		status: "ok" | "failed"
		errorMessage?: string
	}
	[DOMIA_TURN_EVENT_ENUM.INTENT_DECIDED]: {
		decision: string
		intentMs?: number
	}
	[DOMIA_TURN_EVENT_ENUM.LLM_FIRST_SENTENCE]: {
		elapsedMs: number
	}
	[DOMIA_TURN_EVENT_ENUM.LLM_DONE]: {
		llmMs?: number
		llmQueueMs?: number
		promptTokens?: number
		completionTokens?: number
		finishReason?: string
	}
	[DOMIA_TURN_EVENT_ENUM.TOOL_REQUESTED]: {
		toolName: string
		provider?: string
	}
	[DOMIA_TURN_EVENT_ENUM.TOOL_STARTED]: {
		toolName: string
		provider?: string
		riskClass?: string
		policyDecision?: string
		argsHash?: string
	}
	[DOMIA_TURN_EVENT_ENUM.TOOL_RESULT]: {
		toolName: string
		status: TurnEventToolStatusType
		toolMs?: number
		durationMs?: number
	}
	[DOMIA_TURN_EVENT_ENUM.TTS_FIRST_AUDIO]: {
		ttsFirstChunkMs?: number
	}
	[DOMIA_TURN_EVENT_ENUM.PLAYBACK_STARTED]: {
		playedLocally?: boolean
	}
	[DOMIA_TURN_EVENT_ENUM.PLAYBACK_FINISHED]: {
		status: PlaybackStatusType
		playedLocally: boolean
	}
	[DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED]: {
		status: string
		ttfaMs?: number
		perceivedTtfaMs?: number
		llmQueueMs?: number
		llmFirstSentenceMs?: number
		ttsFirstChunkMs?: number
		llmMs?: number
		ttsMs?: number
		totalMs?: number
	}
	[DOMIA_TURN_EVENT_ENUM.TURN_FAILED]: {
		step?: string
		errorCode?: string
		errorMessage: string
	}
	[DOMIA_TURN_EVENT_ENUM.TURN_ABORTED]: {
		reason?: string
	}
	[DOMIA_TURN_EVENT_ENUM.SPECULATION_STARTED]: {
		executorKey?: string
	}
	[DOMIA_TURN_EVENT_ENUM.SPECULATION_COMMITTED]: {
		executorKey?: string
	}
	[DOMIA_TURN_EVENT_ENUM.SPECULATION_DISCARDED]: {
		executorKey?: string
	}
}

export type DomiaTurnEventInputType = {
	[K in DOMIA_TURN_EVENT_ENUM]: TurnEventEnvelopeType & {
		type: K
	} & TurnEventBodyMapType[K]
}[DOMIA_TURN_EVENT_ENUM]

export type DomiaTurnEventType = DomiaTurnEventInputType & {
	ts: number
	seq: number
}

export type TurnEventFilterType =
	| "*"
	| {
			domiaKey?: string
			types?: DOMIA_TURN_EVENT_ENUM[]
			interactionId?: string
			satelliteId?: string
	  }

export type TurnEventListenerType = (
	event: DomiaTurnEventType,
) => void | Promise<void>

export type RegisteredListenerType = {
	filter: TurnEventFilterType
	listener: TurnEventListenerType
}

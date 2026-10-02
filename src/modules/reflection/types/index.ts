import type {
	EmotionAppraisalType,
	UserEmotionType,
} from "@/modules/emotion-engine"
import type { RawFactType } from "@/modules/memory"
import type { LoggerType } from "@/utils"

import type { TURN_KIND_ENUM_VALUES } from "../constants"

export type TurnKindType = (typeof TURN_KIND_ENUM_VALUES)[number]

export type TurnTraceType = {
	intentDecision?: string | null
	toolCallCount?: number | null
	skillResponse?: unknown[] | null
}

export type ReflectionFlagsType = {
	emotion: boolean
	facts: boolean
}

export type ReflectionResultType = {
	emotion: EmotionAppraisalType | null
	userEmotion: UserEmotionType | null
	facts: RawFactType[]
}

export type ReflectionGateDepsType = {
	activeVoiceReplies: () => number
	sleep: (ms: number) => Promise<void>
	now: () => number
	logger: LoggerType
}

export type ReflectionGateType = {
	waitForIdle: (settings: ReflectionGateSettingsType) => Promise<boolean>
	runGated: <T>(
		identityId: string,
		settings: ReflectionGateSettingsType,
		fn: () => Promise<T>,
		skipValue: T,
		priority?: boolean,
	) => Promise<T>
}

export type ReflectionGateSettingsType = {
	onlyWhenIdle: boolean
	concurrency: number
	queueMaxDepth: number
	yieldToVoice: boolean
	timeoutMs: number
	idlePollMs: number
	idleGraceMs: number
	maxIdleWaitMs: number
	slotTimeoutMs: number
	yieldMaxAttempts: number
}

export type ReflectionRetryInputType = {
	factsEnabled: boolean
	explicitMemory: boolean
	hasReflectionModel: boolean
	keptCount: number
	userText: string
}

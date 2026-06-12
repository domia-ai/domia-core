import type {
	EmotionAppraisalType,
	UserEmotionType,
} from "@/modules/emotion-engine"
import type { RawFactType } from "@/modules/memory"

export type ReflectionFlagsType = {
	emotion: boolean
	facts: boolean
}

export type ReflectionResultType = {
	emotion: EmotionAppraisalType | null
	userEmotion: UserEmotionType | null
	facts: RawFactType[]
}

export type ReflectionGateSettingsType = {
	onlyWhenIdle: boolean
	concurrency: number
	queueMaxDepth: number
	yieldToVoice: boolean
}

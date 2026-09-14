export type {
	VoiceFeelConditionType,
	VoiceFeelFeatureKeyType,
	VoiceFeelFeaturesType,
	VoiceFeelKnobType,
	VoiceFeelRuleType,
} from "@/db/json-types"

import type { VoiceFeelFeaturesType, VoiceFeelRuleType } from "@/db/json-types"

export type VoiceFeelTraceRowType = {
	status: string
	implicitFeedback?: string | null
	heardReply?: string | null
	llmResponse?: string | null
	eouDelayMs?: number | null
	endpointDebounceMs?: number | null
	perceivedTtfaMs?: number | null
	sttResult?: string | null
}

export type VoiceFeelDeltaType = {
	section: string
	field: string
	step: number
}

export type VoiceFeelConfigType = Record<
	string,
	Record<string, unknown> | undefined
>

export type VoiceFeelLedgerEntryType = {
	ruleId: string
	section: string
	field: string
	at: number
}

export type VoiceFeelLimitsType = {
	defaults: Record<string, number>
	dailyBudget: number
	cooldownMs: number
	now?: () => number
}

export type VoiceFeelRecommendationType = {
	ruleId: string
	section: string
	field: string
	from: number
	to: number
	features: VoiceFeelFeaturesType
	sampleSize: number
	confidence: number
}

export type VoiceFeelEngineType = {
	evaluate: (
		rules: readonly VoiceFeelRuleType[],
		features: VoiceFeelFeaturesType,
		current: VoiceFeelConfigType,
		ledger: readonly VoiceFeelLedgerEntryType[],
	) => VoiceFeelRecommendationType | null
}

export type VoiceFeelConfigSourceType = {
	wakeWordConfig?: Record<string, unknown> | null
	llmModelConfig?: Record<string, unknown> | null
}

export type VoiceFeelSettingsType = {
	enabled: boolean
	windowTurns: number
	minTurns: number
	dailyBudget: number
	cooldownMs: number
}

export type VoiceFeelAdjustmentViewType = {
	id: string
	ruleId: string
	section: string
	field: string
	from: number
	to: number
	sampleSize: number
	confidence: number
	configRevision: number | null
	createdAt: string
	appliedAt: string | null
	revertedAt: string | null
}

export type VoiceFeelCooldownType = {
	section: string
	field: string
	ruleId: string
	remainingMs: number
	until: string
}

export type VoiceFeelSnapshotType = {
	enabled: boolean
	settings: VoiceFeelSettingsType
	features: VoiceFeelFeaturesType
	budgetUsedToday: number
	cooldowns: VoiceFeelCooldownType[]
	adjustments: VoiceFeelAdjustmentViewType[]
}

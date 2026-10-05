import type { LlmChoiceRequestType } from "@/modules/llm-engine"

export type IntentDecisionType = {
	needsSkill: boolean
	reason:
		| "always-agent"
		| "numeric-followup"
		| "clarified"
		| "nothing-to-retry"
		| "judge:none"
		| "judge:failed"
		| `question:${string}`
		| `negated:${string}`
		| `retry:${string}`
		| `judge:${string}`
}

export type IntentToolHintType = {
	name: string
	description?: string
	examples?: string[]
}

export type IntentCacheEntryType = {
	scope: string
	tool: string | null
}

export type IntentCacheStatsType = {
	entries: number
	hits: number
	misses: number
}

export type ToolJudgeRemoteType = (
	request: LlmChoiceRequestType,
) => Promise<string | null>

export type ToolJudgeVerdictType = {
	tool: string | null
	failed: boolean
}

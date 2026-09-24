export type IntentDecisionType = {
	needsSkill: boolean
	reason:
		| "always-agent"
		| "builtin-keyword"
		| "no-routable-tools"
		| "fast-router"
		| "no-local-llm"
		| "classified"
		| "classify-failed"
		| "single-slot-skip-llm"
		| "numeric-followup"
		| `personal:${string}`
		| `state-question:${string}`
		| `retry:${string}`
		| `keyphrase:${string}`
		| `keyword:${string}`
		| `embedding:${string}`
		| `cache:${string}`
}

export type IntentToolHintType = {
	name: string
	description?: string
}

export type IntentRoutingHintsType = {
	exampleUtterances?: string[]
	keywords?: string[]
}

export type IntentCacheEntryType = {
	scope: string
	vector: number[] | null
	needsSkill: boolean
}

export type IntentCacheStatsType = {
	entries: number
	exactHits: number
	semanticHits: number
	misses: number
}

export type IntentEmbeddingOutcomeType = {
	outcome: IntentDecisionType | "ambiguous" | null
	vector: number[] | null
}

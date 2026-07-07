export type IntentDecisionType = {
	needsSkill: boolean
	reason:
		| "always-agent"
		| "fast-router"
		| "no-local-llm"
		| "classified"
		| "classify-failed"
		| `keyphrase:${string}`
		| `keyword:${string}`
		| `embedding:${string}`
}

export type IntentToolHintType = {
	name: string
	description?: string
}

export type IntentRoutingHintsType = {
	exampleUtterances?: string[]
	keywords?: string[]
}

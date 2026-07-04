export type IntentDecisionType = {
	needsSkill: boolean
	reason:
		| "always-agent"
		| "no-local-llm"
		| "classified"
		| "classify-failed"
		| `keyphrase:${string}`
		| `embedding:${string}`
}

export type IntentToolHintType = {
	name: string
	description?: string
}

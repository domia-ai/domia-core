export type IntentDecisionType = {
	needsSkill: boolean
	reason: "always-agent" | "no-local-llm" | "classified" | "classify-failed"
}

export type IntentToolHintType = {
	name: string
	description?: string
}

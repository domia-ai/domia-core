export type SkillAuthType =
	| { kind: "bearer"; token: string }
	| { kind: "headers"; headers: Record<string, string> }

export type SkillToolType = {
	provider: string
	rawName: string
	namespacedName: string
	description?: string
	inputSchema: Record<string, unknown>
}

export type ToolFinalizeRuleType = {
	mode: "agent_loop" | "template"
	ack?: string
	error?: string
}

export type ToolFinalizeMapType = Record<string, ToolFinalizeRuleType>

export type SkillProviderConfigType = Record<string, unknown>

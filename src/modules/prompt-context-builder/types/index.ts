export const INPUT_INTENT_TYPE_ENUM = {
	MCP_CALL: "MCP_CALL",
	LLM_REQUEST: "LLM_REQUEST",
} as const

export type InputIntentTypeType =
	(typeof INPUT_INTENT_TYPE_ENUM)[keyof typeof INPUT_INTENT_TYPE_ENUM]

export type InputIntentType = {
	type: InputIntentTypeType
	mcpKeys?: string[]
}

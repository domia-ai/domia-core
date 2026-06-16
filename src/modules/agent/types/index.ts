import type {
	ChatMessageType,
	ToolCallOrReplyType,
	StreamReplyOrToolsType,
	ToolDefinitionType,
} from "@/modules/llm-engine"

export type AgentInferenceType = (
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
) => Promise<ToolCallOrReplyType>

export type AgentStreamInferenceType = (
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
) => Promise<StreamReplyOrToolsType>

export type AgentTurnOptionsType = {
	voice?: boolean
	streamFinalize?: AgentStreamInferenceType
}

export type AgentFinalizeModeType = "agent_loop" | "template" | "streamed"

export type AgentResultType = {
	reply: string
	replyStream?: AsyncIterable<string>
	toolNamesUsed: string[]
	serversUsed: string[]
	steps: number
	skillPrompt: string | null
	skillResponses: unknown[]
	decisionMs: number
	toolMs: number
	finalizeMs: number
	finalizeMode: AgentFinalizeModeType
}

import type {
	ChatMessageType,
	ToolCallOrReplyType,
	StreamReplyOrToolsType,
	ToolDefinitionType,
} from "@/modules/llm-engine"
import type { ToolTraceEntryType } from "@/db"

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
	onSlowTool?: () => void
	slowToolAfterMs?: number
	allowAsyncTools?: boolean
	signal?: AbortSignal
	budgetMs?: number
	confirmationChannel?: string
}

export type AgentFinalizeModeType = "agent_loop" | "template" | "streamed"

export type AgentStopReasonType =
	| "completed"
	| "max_steps"
	| "tool_error"
	| "aborted"
	| "context_overflow"
	| "confirm_required"

export type PendingConfirmationType = {
	tool: string
	args: Record<string, unknown>
	language: string | null
	expiresAt: number
	reasked?: boolean
}

export type AgentResultType = {
	reply: string
	replyStream?: AsyncIterable<string>
	toolNamesUsed: string[]
	serversUsed: string[]
	steps: number
	skillPrompt: string | null
	skillResponses: ToolTraceEntryType[]
	decisionMs: number
	toolMs: number
	finalizeMs: number
	finalizeMode: AgentFinalizeModeType
	stopReason: AgentStopReasonType
	pendingTools?: Promise<AsyncToolOutcomeType>[]
}

export type AsyncToolOutcomeType = {
	tool: string
	ok: boolean
	doneText: string
	resolvedArgs?: Record<string, unknown>
}

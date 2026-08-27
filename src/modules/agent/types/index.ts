import type {
	ChatMessageType,
	ToolCallOrReplyType,
	ToolChoiceType,
	StreamReplyOrToolsType,
	ToolDefinitionType,
} from "@/modules/llm-engine"
import type { ToolTraceEntryType } from "@/db"

export type AgentInferenceType = (
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
	toolChoice?: ToolChoiceType,
	signal?: AbortSignal,
) => Promise<ToolCallOrReplyType>

export type AgentStreamInferenceType = (
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
	toolChoice?: ToolChoiceType,
	signal?: AbortSignal,
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
	canConfirm?: boolean
	recentToolsLine?: string
	constrainedRepair?: (
		prompt: string,
		schema: Record<string, unknown>,
	) => Promise<string | null>
}

export type AgentFinalizeModeType =
	| "agent_loop"
	| "template"
	| "streamed"
	| "authored"

export type StructuredDecisionRunnerType = (
	messages: ChatMessageType[],
	schema: Record<string, unknown>,
	signal?: AbortSignal,
) => Promise<string | null>

export type AgentStopReasonType =
	| "completed"
	| "max_steps"
	| "tool_error"
	| "aborted"
	| "context_overflow"
	| "confirm_required"
	| "call_cap"

export type ToolGuardConfigType = {
	repeatWarnAt: number
	repeatBlockAt: number
	maxCallsPerTurn: number
}

export type ToolGuardVerdictType = {
	action: "allow" | "block"
	syntheticResult?: string
	forceNoTool?: boolean
}

export type ConfirmationSettleStatusType =
	| "approved"
	| "denied"
	| "ignored"
	| "expired"
	| "superseded"

export type PendingConfirmationType = {
	tool: string
	args: Record<string, unknown>
	resolvedArgs?: Record<string, unknown>
	language: string | null
	expiresAt: number
	reasked?: boolean
	summary?: string
}

export type AgentResultType = {
	reply: string
	replyStream?: AsyncIterable<string>
	replyStreamClose?: () => void
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

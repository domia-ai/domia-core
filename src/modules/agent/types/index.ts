import type {
	ChatMessageType,
	ToolCallOrReplyType,
	ToolCallType,
	ToolChoiceType,
	StreamReplyOrToolsType,
	ToolDefinitionType,
} from "@/modules/llm-engine"
import type { ToolTraceEntryType } from "@/db"
import type { DomiaType } from "@/modules/core"
import type { SkillCallResultType } from "@/modules/skill-engine"
import type { ResolvedLanguageSetsType } from "@/utils"

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
	lastActedTarget?: string
	retryCall?: AgentRetryCallType
	knownFacts?: string[]
	knowledgeBase?: string[]
	constrainedRepair?: (
		prompt: string,
		schema: Record<string, unknown>,
	) => Promise<string | null>
}

export type AgentRetryCallType = {
	tool: string
	args: Record<string, unknown>
}

export type ToolAliasMapType = {
	toolDefs: ToolDefinitionType[]
	aliases: string[]
	aliasOf: (namespacedName: string) => string
	namespacedOf: (advertisedName: string) => string | undefined
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
	| "inference_error"

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

export type ToolGuardsType = {
	onCallAttempt: (
		name: string,
		args: Record<string, unknown>,
	) => ToolGuardVerdictType
	onResult: (
		name: string,
		args: Record<string, unknown>,
		ok: boolean,
		text: string,
		cacheOk: boolean,
	) => void
	wasCapTripped: () => boolean
}

export type ToolRunOutcomeType = {
	result: SkillCallResultType
	ms: number
}

export type AgentTurnContextType = {
	readonly domia: DomiaType
	readonly transcript: string
	readonly inference: AgentInferenceType
	readonly opts: AgentTurnOptionsType | undefined
	readonly system: string
	readonly language: string | null
	readonly aliasMap: ToolAliasMapType
	readonly namespacedOf: (emitted: string) => string | null
	readonly toolDefs: ToolDefinitionType[]
	readonly readToolDefs: ToolDefinitionType[]
	readonly allowedParams: Map<string, Set<string> | null>
	readonly requiredParams: Map<string, string[]>
	readonly toolSchemas: Map<string, Record<string, unknown>>
	readonly maxSteps: number
	readonly effectiveSignal: AbortSignal | undefined
	readonly tokenBudget: number
	readonly guards: ToolGuardsType
	readonly interrogative: boolean
	readonly targetGuard: boolean
	readonly readThenAnswer: boolean
	readonly languageSets: ResolvedLanguageSetsType
	readonly retryCall: AgentRetryCallType | null
	readonly messages: ChatMessageType[]
	readonly toolNamesUsed: string[]
	readonly serversUsed: Set<string>
	readonly skillResponses: ToolTraceEntryType[]
	readonly idemCache: Map<string, ToolRunOutcomeType>
	readonly argCorrected: Set<string>
	decisionMs: number
	toolMs: number
	finalizeMs: number
	forceNoTool: boolean
	taintedByOpenWorld: boolean
	readOnlyRound: boolean
	readOnlyRetried: boolean
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

export type PendingConfirmationViewType = {
	scope: string
	satelliteId: string | null
	tool: string
	args: Record<string, unknown>
	resolvedArgs: Record<string, unknown> | null
	summary: string | null
	language: string | null
	reasked: boolean
	expiresAt: number
}

export type ConfirmationDecisionType = "yes" | "no"

export type ConfirmationSettleOutcomeType = {
	settled: boolean
	ran?: boolean
	result?: SkillCallResultType
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

export type ScreenedCallType = {
	idx: number
	call: ToolCallType
	safeArgs: Record<string, unknown>
}

export type ConfirmTargetType = {
	call: ToolCallType
	confirmArgs: Record<string, unknown>
	resolvedArgs: Record<string, unknown>
	resolutionFailed: boolean
}

export type ScreenedBatchType = {
	toRun: ScreenedCallType[]
	callMessages: (string | null)[]
	allTemplate: boolean
	confirmTarget: ConfirmTargetType | null
}

export type ToolExecutionOutcomeType =
	| { kind: "aborted"; outcome: AgentStepOutcomeType }
	| { kind: "respond_first"; outcome: AgentStepOutcomeType }
	| {
			kind: "settled"
			templateParts: string[]
			allTemplate: boolean
			sayEligible: boolean
	  }

export type CallPolicyVerdictType =
	| { kind: "run" }
	| { kind: "blocked"; message: string }
	| { kind: "read_only_retry"; message: string }
	| { kind: "confirm"; target: ConfirmTargetType }

export type AgentDecisionOutcomeType =
	| {
			kind: "tool_calls"
			calls: ToolCallType[]
			authoredSay: string | null
			injectedRetry: boolean
	  }
	| { kind: "aborted"; outcome: AgentStepOutcomeType }
	| { kind: "stop"; outcome: AgentStepOutcomeType }

export type AgentStepOutcomeType =
	| { kind: "continue" }
	| { kind: "reply"; result: AgentResultType }
	| { kind: "confirm_required"; result: AgentResultType }
	| { kind: "aborted"; result: AgentResultType }
	| { kind: "exhausted"; result: AgentResultType }

export type AgentResultPatchType = {
	reply?: string
	replyStream?: AsyncIterable<string>
	replyStreamClose?: () => void
	steps?: number
	finalizeMode?: AgentFinalizeModeType
	stopReason?: AgentStopReasonType
	pendingTools?: Promise<AsyncToolOutcomeType>[]
}

export type AsyncToolOutcomeType = {
	tool: string
	ok: boolean
	doneText: string
	resolvedArgs?: Record<string, unknown>
}

import type { LlmEngineEnumType } from "@/db"
import type { DomiaType } from "@/modules/core"

export type LlmCapabilitiesType = {
	streaming: boolean
	tools?: boolean
}

export type ChatMessageRoleType = "system" | "user" | "assistant" | "tool"

export type ToolCallType = {
	name: string
	arguments: Record<string, unknown>
}

export type ChatMessageType = {
	role: ChatMessageRoleType
	content: string
	toolName?: string
	toolCalls?: ToolCallType[]
}

export type ToolDefinitionType = {
	name: string
	description?: string
	parameters: Record<string, unknown>
}

export type LlmUsageType = {
	promptTokens?: number | null
	completionTokens?: number | null
	tokensPerSec?: number | null
	ttftMs?: number | null
	contextWindow?: number | null
	finishReason?: string | null
}

export type LlmUsageSinkType = (usage: LlmUsageType) => void

export type ToolCallOrReplyType =
	| { kind: "reply"; text: string }
	| { kind: "tool_calls"; calls: ToolCallType[] }

export type StreamReplyOrToolsType =
	| { kind: "reply"; tokens: AsyncIterable<string> }
	| { kind: "tool_calls"; calls: ToolCallType[] }

export type LlmEngineAdapterType = {
	id: LlmEngineEnumType
	capabilities: LlmCapabilitiesType
	run: (
		domia: DomiaType,
		promptContext: string,
		onUsage?: LlmUsageSinkType,
	) => Promise<string>
	runStream?: (
		domia: DomiaType,
		promptContext: string,
		shouldAbort?: () => boolean,
		onUsage?: LlmUsageSinkType,
	) => AsyncIterable<string>
	warmup?: (domia: DomiaType) => Promise<void>
	runJson?: (
		domia: DomiaType,
		promptContext: string,
		shouldAbort?: () => boolean,
	) => Promise<string>
	runWithTools?: (
		domia: DomiaType,
		messages: ChatMessageType[],
		tools: ToolDefinitionType[],
		onUsage?: LlmUsageSinkType,
	) => Promise<ToolCallOrReplyType>
	runReplyStreamOrTools?: (
		domia: DomiaType,
		messages: ChatMessageType[],
		tools: ToolDefinitionType[],
		onUsage?: LlmUsageSinkType,
	) => Promise<StreamReplyOrToolsType>
	runIntent?: (
		domia: DomiaType,
		prompt: string,
		modelName: string,
	) => Promise<string>
}

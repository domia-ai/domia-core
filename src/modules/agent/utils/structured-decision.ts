import type {
	ChatMessageType,
	ToolDefinitionType,
	ToolChoiceType,
	ToolCallOrReplyType,
} from "@/modules/llm-engine"
import { sanitizeJsonSchema } from "@/modules/llm-engine"
import type { DomiaType } from "@/modules/core"
import { agentLogger, parseLlmJson } from "@/utils"

import type { AgentInferenceType, StructuredDecisionRunnerType } from "../types"

const NONE_TOOL = "none"
const CARD_DESCRIPTION_MAX = 120

export const structuredDecisionSchema = (
	tools: ToolDefinitionType[],
): Record<string, unknown> => {
	const branches: Record<string, unknown>[] = tools.map((t) => ({
		type: "object",
		properties: {
			tool: { const: t.name },
			args: sanitizeJsonSchema(t.parameters) ?? { type: "object" },
			say: { type: "string" },
		},
		required: ["tool", "args", "say"],
	}))
	branches.push({
		type: "object",
		properties: {
			tool: { const: NONE_TOOL },
			say: { type: "string" },
		},
		required: ["tool", "say"],
	})
	return branches.length === 1 ? branches[0] : { anyOf: branches }
}

const toolCard = (tool: ToolDefinitionType): string => {
	const props = (tool.parameters as { properties?: Record<string, unknown> })
		?.properties
	const required = new Set(
		Array.isArray((tool.parameters as { required?: unknown })?.required)
			? ((tool.parameters as { required: unknown[] }).required as string[]).map(
					String,
				)
			: [],
	)
	const params =
		props && typeof props === "object"
			? Object.keys(props)
					.map((k) => (required.has(k) ? k : `${k}?`))
					.join(", ")
			: ""
	const description = (tool.description ?? "").slice(0, CARD_DESCRIPTION_MAX)
	return `- ${tool.name}(${params})${description ? ` — ${description}` : ""}`
}

const decisionInstructions = (tools: ToolDefinitionType[]): string => {
	const cards =
		tools.length > 0 ? `\n\nTOOLS:\n${tools.map(toolCard).join("\n")}` : ""
	return `${cards}\n\nRespond with ONE JSON object: {"tool": "<tool name or ${NONE_TOOL}>", "args": {<tool arguments>}, "say": "<your spoken reply>"}. Use "${NONE_TOOL}" and put your full answer in "say" when no tool is needed. When calling a tool, "say" is one short sentence confirming the action.`
}

const withDecisionSystem = (
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
): ChatMessageType[] =>
	messages.map((m, i) =>
		i === 0 && m.role === "system"
			? { ...m, content: `${m.content}${decisionInstructions(tools)}` }
			: m,
	)

export const createStructuredInference = (
	domia: DomiaType,
	runner: StructuredDecisionRunnerType,
): AgentInferenceType => {
	return async (
		messages: ChatMessageType[],
		tools: ToolDefinitionType[],
		toolChoice?: ToolChoiceType,
		signal?: AbortSignal,
	): Promise<ToolCallOrReplyType> => {
		const usable = toolChoice === "none" ? [] : tools
		const schema = structuredDecisionSchema(usable)
		const raw = await runner(
			withDecisionSystem(messages, usable),
			schema,
			signal,
		)
		if (raw == null)
			throw new Error("structured decision unavailable for this engine")
		if (!raw) return { kind: "reply", text: "" }
		const { value, state } = parseLlmJson(raw)
		if (state === "repaired")
			agentLogger.warn("structured decision JSON repaired", {
				site: "structured-decision",
				model: domia.llmModelConfig?.modelName,
				rawLength: raw.length,
			})
		const obj =
			value && typeof value === "object" && !Array.isArray(value)
				? (value as { tool?: unknown; args?: unknown; say?: unknown })
				: null
		if (!obj) throw new Error("structured decision unparseable")
		const say = typeof obj.say === "string" ? obj.say.trim() : ""
		const tool = typeof obj.tool === "string" ? obj.tool.trim() : NONE_TOOL
		if (!tool || tool === NONE_TOOL) return { kind: "reply", text: say }
		const args =
			obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)
				? (obj.args as Record<string, unknown>)
				: {}
		return {
			kind: "tool_calls",
			calls: [{ name: tool, arguments: args }],
			say: say || undefined,
		}
	}
}

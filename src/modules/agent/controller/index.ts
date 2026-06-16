import {
	DEFAULT_AGENT_MAX_STEPS,
	SKILL_TOOL_NAME_SEPARATOR,
	AGENT_PROMPT_MODE_ENUM,
	DEFAULT_FINALIZE_ACK,
	DEFAULT_FINALIZE_ERROR,
} from "@/db"
import type { SkillToolType } from "@/db"
import type { DomiaType } from "@/modules/core"
import type {
	ChatMessageType,
	ToolCallOrReplyType,
	ToolDefinitionType,
} from "@/modules/llm-engine"
import { callTool, resolveToolFinalize } from "@/modules/skill-engine"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import { agentLogger } from "@/utils"

import {
	SKILLS_CLAUSE,
	AGENT_FAILURE_REPLY,
	AGENT_ACTED_FAILURE_REPLY,
} from "../constants"
import type {
	AgentInferenceType,
	AgentResultType,
	AgentTurnOptionsType,
} from "../types"

const isEmptyArg = (v: unknown): boolean =>
	v == null ||
	v === "" ||
	(Array.isArray(v) && v.length === 0) ||
	(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)

const pruneEmptyArgs = (
	args: Record<string, unknown>,
): Record<string, unknown> => {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(args)) if (!isEmptyArg(v)) out[k] = v
	return out
}

const filterToAllowed = (
	args: Record<string, unknown>,
	allow: Set<string> | null | undefined,
): Record<string, unknown> => {
	if (allow == null) return args
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(args)) if (allow.has(k)) out[k] = v
	return out
}

const toToolDefs = (tools: SkillToolType[]): ToolDefinitionType[] =>
	tools.map((t) => ({
		name: t.namespacedName,
		description: t.description,
		parameters: t.inputSchema,
	}))

const buildAgentSystem = (domia: DomiaType, transcript: string): string => {
	const mode =
		domia.llmModelConfig?.agentPromptMode ?? AGENT_PROMPT_MODE_ENUM.COMPACT
	if (mode === AGENT_PROMPT_MODE_ENUM.FULL) {
		const persona = buildPromptContext(domia, transcript, {
			omitUserInput: true,
		})
		return `### HOME CONTROL (highest priority)\n${SKILLS_CLAUSE}\n\n${persona}`
	}
	const cp = domia.characterProfile
	const name = cp?.name?.trim() || "Domia"
	const lang = cp?.language || "en"
	const replyRule = `When you are not calling a tool, answer in one short, natural sentence in the user's language (default ${lang}); never describe the tools or your reasoning.`
	if (mode === AGENT_PROMPT_MODE_ENUM.LEAN) {
		return `${SKILLS_CLAUSE}\n\nYou are ${name}. ${replyRule}`
	}
	const traits = [cp?.personality, cp?.communicationStyle]
		.map((t) => t?.trim().toLowerCase())
		.filter((t): t is string => Boolean(t) && t !== "neutral")
		.join(", ")
	const personaLine = traits
		? `You are ${name} — ${traits}.`
		: `You are ${name}.`
	return `${SKILLS_CLAUSE}\n\n${personaLine} ${replyRule} Stay in character.`
}

export const runAgentTurn = async (
	domia: DomiaType,
	transcript: string,
	tools: SkillToolType[],
	inference: AgentInferenceType,
	opts?: AgentTurnOptionsType,
): Promise<AgentResultType> => {
	const toolDefs = toToolDefs(tools)
	const system = buildAgentSystem(domia, transcript)
	const messages: ChatMessageType[] = [
		{ role: "system", content: system },
		{ role: "user", content: transcript },
	]
	const toolNamesUsed: string[] = []
	const serversUsed = new Set<string>()
	const skillResponses: unknown[] = []
	let decisionMs = 0
	let toolMs = 0
	let finalizeMs = 0
	const maxSteps =
		domia.llmModelConfig?.agentMaxSteps ?? DEFAULT_AGENT_MAX_STEPS
	const allowedParams = new Map<string, Set<string> | null>(
		tools.map((t) => {
			const props = t.inputSchema?.properties as
				| Record<string, unknown>
				| undefined
			return [
				t.namespacedName,
				props && typeof props === "object" ? new Set(Object.keys(props)) : null,
			]
		}),
	)

	for (let step = 0; step < maxSteps; step++) {
		let out: ToolCallOrReplyType
		const streamFinalize =
			opts?.voice && opts.streamFinalize && toolNamesUsed.length > 0
				? opts.streamFinalize
				: null
		const inferStart = process.hrtime.bigint()
		try {
			if (streamFinalize) {
				const res = await streamFinalize(messages, toolDefs)
				if (res.kind === "reply") {
					return {
						reply: "",
						replyStream: res.tokens,
						toolNamesUsed,
						serversUsed: [...serversUsed],
						steps: step + 1,
						skillPrompt: SKILLS_CLAUSE,
						skillResponses,
						decisionMs,
						toolMs,
						finalizeMs,
						finalizeMode: "streamed",
					}
				}
				out = { kind: "tool_calls", calls: res.calls }
			} else {
				out = await inference(messages, toolDefs)
			}
		} catch (err) {
			if (toolNamesUsed.length === 0) throw err
			agentLogger.warn(
				"agent inference failed after a tool ran — not falling back",
				{ domiaId: domia.id, toolNamesUsed, err },
			)
			return {
				reply: AGENT_ACTED_FAILURE_REPLY,
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "agent_loop",
			}
		}
		const inferMs = Math.round(
			Number(process.hrtime.bigint() - inferStart) / 1e6,
		)

		if (out.kind === "reply") {
			finalizeMs += inferMs
			return {
				reply: out.text,
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "agent_loop",
			}
		}

		decisionMs += inferMs
		messages.push({ role: "assistant", content: "", toolCalls: out.calls })
		const templateParts: string[] = []
		let allTemplate = true
		for (const call of out.calls) {
			toolNamesUsed.push(call.name)
			const sepIdx = call.name.indexOf(SKILL_TOOL_NAME_SEPARATOR)
			if (sepIdx > 0) serversUsed.add(call.name.slice(0, sepIdx))
			const safeArgs = pruneEmptyArgs(
				filterToAllowed(call.arguments, allowedParams.get(call.name)),
			)
			const t0 = process.hrtime.bigint()
			const result = await callTool(call.name, safeArgs)
			const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6)
			toolMs += ms
			skillResponses.push({
				tool: call.name,
				result: result.text,
				status: result.status,
				isError: result.isError,
				ms,
			})
			messages.push({ role: "tool", toolName: call.name, content: result.text })
			const rule = resolveToolFinalize(call.name)
			if (rule?.mode === "template") {
				const ok = result.status === "ok" && !result.isError
				templateParts.push(
					ok
						? (rule.ack ?? DEFAULT_FINALIZE_ACK)
						: (rule.error ?? DEFAULT_FINALIZE_ERROR),
				)
			} else {
				allTemplate = false
			}
		}
		if (allTemplate && templateParts.length > 0) {
			return {
				reply: templateParts.join(" "),
				toolNamesUsed,
				serversUsed: [...serversUsed],
				steps: step + 1,
				skillPrompt: SKILLS_CLAUSE,
				skillResponses,
				decisionMs,
				toolMs,
				finalizeMs,
				finalizeMode: "template",
			}
		}
	}

	agentLogger.warn("agent loop exhausted max steps", {
		domiaId: domia.id,
		toolNamesUsed,
	})
	return {
		reply: AGENT_FAILURE_REPLY,
		toolNamesUsed,
		serversUsed: [...serversUsed],
		steps: maxSteps,
		skillPrompt: SKILLS_CLAUSE,
		skillResponses,
		decisionMs,
		toolMs,
		finalizeMs,
		finalizeMode: "agent_loop",
	}
}

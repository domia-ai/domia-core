import { SKILL_TOOL_NAME_SEPARATOR } from "@/db"
import type {
	SkillToolType,
	ToolTraceEntryType,
	ToolRunStatusType,
	ToolResultErrorCodeType,
} from "@/db"
import { getTraceContext, toError } from "@/utils"
import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import type { ChatMessageType, ToolDefinitionType } from "@/modules/llm-engine"
import { type SkillCallResultType, toolBaseName } from "@/modules/skill-engine"

export const ABORTED = Symbol("agent-aborted")

const TOOL_RESULT_COMPACT_CAP = 240
const COMPACT_SUFFIX = " …[truncated]"

export const mapSkillStatus = (
	status: SkillCallResultType["status"],
): ToolRunStatusType =>
	status === "ok"
		? "ok"
		: status === "timeout"
			? "timeout"
			: status === "cancelled"
				? "cancelled"
				: "failed"

const skillErrorCode = (
	status: SkillCallResultType["status"],
): ToolResultErrorCodeType | undefined =>
	status === "ok" || status === "cancelled" ? undefined : status

export const toToolTraceEntry = (
	tool: string,
	result: SkillCallResultType,
	durationMs: number,
	args: Record<string, unknown>,
): ToolTraceEntryType => ({
	kind: "result",
	tool,
	status: mapSkillStatus(result.status),
	durationMs,
	summaryForLlm: result.text,
	output: result.text,
	errorCode: skillErrorCode(result.status),
	args,
	resolvedArgs: result.resolvedArgs,
})

export const providerOf = (toolName: string): string | undefined => {
	const sepIdx = toolName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	return sepIdx > 0 ? toolName.slice(0, sepIdx) : undefined
}

export const emitToolRequested = (toolName: string): void => {
	const ctx = getTraceContext()
	if (!ctx?.interactionId) return
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.TOOL_REQUESTED,
		interactionId: ctx.interactionId,
		originDomiaKey: ctx.originDomiaKey ?? "",
		traceId: ctx.traceId,
		toolName,
		provider: providerOf(toolName),
	})
}

export const emitToolResult = (
	toolName: string,
	status: ToolRunStatusType,
	toolMs?: number,
): void => {
	const ctx = getTraceContext()
	if (!ctx?.interactionId) return
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.TOOL_RESULT,
		interactionId: ctx.interactionId,
		originDomiaKey: ctx.originDomiaKey ?? "",
		traceId: ctx.traceId,
		toolName,
		status,
		toolMs,
	})
}

export const estimateTokens = (messages: ChatMessageType[]): number => {
	let chars = 0
	for (const m of messages) {
		chars += m.content.length
		if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length
	}
	return Math.ceil(chars / 4)
}

export const compactWithinBudget = (
	messages: ChatMessageType[],
	budgetTokens: number,
): boolean => {
	if (estimateTokens(messages) <= budgetTokens) return true
	for (const m of messages) {
		if (estimateTokens(messages) <= budgetTokens) return true
		if (m.role === "tool" && m.content.length > TOOL_RESULT_COMPACT_CAP) {
			m.content = m.content.slice(0, TOOL_RESULT_COMPACT_CAP) + COMPACT_SUFFIX
		}
	}
	return estimateTokens(messages) <= budgetTokens
}

export const raceAbort = <T>(
	p: Promise<T>,
	signal?: AbortSignal,
): Promise<T | typeof ABORTED> => {
	if (!signal) return p
	if (signal.aborted) return Promise.resolve(ABORTED)
	return new Promise((resolve, reject) => {
		const onAbort = (): void => resolve(ABORTED)
		signal.addEventListener("abort", onAbort, { once: true })
		p.then(
			(v) => {
				signal.removeEventListener("abort", onAbort)
				resolve(v)
			},
			(e: unknown) => {
				signal.removeEventListener("abort", onAbort)
				reject(toError(e))
			},
		)
	})
}

const isEmptyArg = (v: unknown): boolean =>
	v == null ||
	v === "" ||
	(Array.isArray(v) && v.length === 0) ||
	(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)

export const pruneEmptyArgs = (
	args: Record<string, unknown>,
): Record<string, unknown> => {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(args)) if (!isEmptyArg(v)) out[k] = v
	return out
}

export const filterToAllowed = (
	args: Record<string, unknown>,
	allow: Set<string> | null | undefined,
): Record<string, unknown> => {
	if (allow == null) return args
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(args)) if (allow.has(k)) out[k] = v
	return out
}

export const normalizeToolName = (
	name: string,
	known: Set<string>,
): string | null => {
	const stripped = name.replace(/^(functions|tools)[./:]/, "")
	if (known.has(stripped)) return stripped
	const lower = stripped.toLowerCase()
	const ciMatches = [...known].filter((k) => k.toLowerCase() === lower)
	if (ciMatches.length === 1) return ciMatches[0]
	const suffixMatches = [...known].filter((k) =>
		k.toLowerCase().endsWith(`${SKILL_TOOL_NAME_SEPARATOR}${lower}`),
	)
	if (suffixMatches.length === 1) return suffixMatches[0]
	const base = toolBaseName(stripped).toLowerCase()
	const baseMatches = [...known].filter(
		(k) => toolBaseName(k).toLowerCase() === base,
	)
	if (baseMatches.length === 1) return baseMatches[0]
	return null
}

export const toToolDefs = (tools: SkillToolType[]): ToolDefinitionType[] =>
	tools.map((t) => ({
		name: t.namespacedName,
		description: t.description,
		parameters: t.inputSchema,
	}))

import { llmEngineLogger, parseLlmJson, wrapUntrustedToolOutput } from "@/utils"

import type {
	ChatMessageType,
	ToolCallOrReplyType,
	ToolCallType,
	ToolDefinitionType,
} from "../../types"
import type {
	GrammarStreamGateType,
	GrammarStreamVerdictType,
	PythonicCallSegmentType,
} from "./types"
import { TOOL_CATALOG_HEADER } from "./constants"
import { normalizeArgs } from "./mapping"

const gbnfString = (value: string): string =>
	`"\\"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}\\""`

export const toolGrammar = (tools: ToolDefinitionType[]): string => {
	const names = tools.map((t) => gbnfString(t.name)).join(" | ")
	return [
		'root ::= ws? (";" ws)? call (ws ";" ws call)* ws? | answer',
		"answer ::= [^{;\\n] [^\\n]*",
		'call ::= "{" ws "\\"name\\"" ws ":" ws NAME ws "," ws "\\"parameters\\"" ws ":" ws obj ws "}"',
		`NAME ::= ${names}`,
		'obj ::= "{" ws (pair (ws "," ws pair)*)? ws "}"',
		'pair ::= string ws ":" ws value',
		'value ::= string | "null" | "true" | "false" | number | arr | obj',
		'arr ::= "[" ws (value (ws "," ws value)*)? ws "]"',
		'string ::= "\\"" ([^"\\\\] | "\\\\" .)* "\\""',
		'number ::= "-"? [0-9]+ ("." [0-9]+)?',
		"ws ::= [ \\t]*",
	].join("\n")
}

const toolLine = (tool: ToolDefinitionType): string =>
	JSON.stringify({
		name: tool.name,
		description: tool.description ?? "",
		parameters: tool.parameters,
	})

export const toolCatalogBlock = (tools: ToolDefinitionType[]): string =>
	`${TOOL_CATALOG_HEADER}\n\n${tools.map(toolLine).join("\n")}`

export const withToolCatalog = (
	messages: ChatMessageType[],
	tools: ToolDefinitionType[],
): ChatMessageType[] => {
	const block = toolCatalogBlock(tools)
	if (messages.length > 0 && messages[0].role === "system")
		return [
			{ ...messages[0], content: `${messages[0].content}\n\n${block}` },
			...messages.slice(1),
		]
	return [{ role: "system", content: block }, ...messages]
}

const splitObjects = (text: string): string[] => {
	const out: string[] = []
	let depth = 0
	let start = -1
	let inString = false
	let escaped = false
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (inString) {
			if (escaped) escaped = false
			else if (ch === "\\") escaped = true
			else if (ch === '"') inString = false
			continue
		}
		if (ch === '"') {
			inString = true
			continue
		}
		if (ch === "{") {
			if (depth === 0) start = i
			depth++
			continue
		}
		if (ch === "}" && depth > 0) {
			depth--
			if (depth === 0 && start >= 0) {
				out.push(text.slice(start, i + 1))
				start = -1
			}
		}
	}
	if (depth > 0 && start >= 0) out.push(text.slice(start))
	return out
}

const callOf = (chunk: string, model?: string): ToolCallType | null => {
	const { value, state } = parseLlmJson(chunk)
	if (state === "repaired")
		llmEngineLogger.warn("grammar tool-call JSON repaired", {
			site: "openai-compatible-grammar",
			model,
			rawLength: chunk.length,
		})
	if (!value) return null
	const name = typeof value.name === "string" ? value.name.trim() : ""
	if (!name) return null
	const { args, invalid } = normalizeArgs(value.parameters)
	return { name, arguments: args, argsInvalid: invalid || undefined }
}

const SEGMENT_HEAD_RE = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*\(/
const SEPARATOR_RE = /[\s;,]/
const KEYWORD_ARG_RE = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*([\s\S]*)$/
const NUMBER_RE = /^-?\d+(\.\d+)?$/
const FALLBACK_POSITIONAL_KEY = "name"

const positionalKeyOf = (tool: ToolDefinitionType): string => {
	const required = tool.parameters.required
	const first: unknown = Array.isArray(required) ? required[0] : undefined
	return typeof first === "string" && first.length > 0
		? first
		: FALLBACK_POSITIONAL_KEY
}

const closingParen = (text: string, from: number): number => {
	let depth = 1
	let quote: string | null = null
	let escaped = false
	for (let i = from; i < text.length; i++) {
		const ch = text[i]
		if (quote !== null) {
			if (escaped) escaped = false
			else if (ch === "\\") escaped = true
			else if (ch === quote) quote = null
			continue
		}
		if (ch === '"' || ch === "'") {
			quote = ch
			continue
		}
		if (ch === "(") depth++
		else if (ch === ")") {
			depth--
			if (depth === 0) return i
		}
	}
	return -1
}

const pythonicSegments = (text: string): PythonicCallSegmentType[] | null => {
	const body =
		text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1).trim() : text
	const out: PythonicCallSegmentType[] = []
	let cursor = 0
	while (cursor < body.length) {
		while (cursor < body.length && SEPARATOR_RE.test(body[cursor])) cursor++
		if (cursor >= body.length) break
		const head = SEGMENT_HEAD_RE.exec(body.slice(cursor))
		if (!head) return null
		const open = cursor + head[0].length
		const close = closingParen(body, open)
		if (close < 0) return null
		out.push({ name: head[1], args: body.slice(open, close) })
		cursor = close + 1
	}
	return out.length > 0 ? out : null
}

const splitArgParts = (args: string): string[] => {
	const out: string[] = []
	let depth = 0
	let quote: string | null = null
	let escaped = false
	let start = 0
	for (let i = 0; i < args.length; i++) {
		const ch = args[i]
		if (quote !== null) {
			if (escaped) escaped = false
			else if (ch === "\\") escaped = true
			else if (ch === quote) quote = null
			continue
		}
		if (ch === '"' || ch === "'") quote = ch
		else if (ch === "(" || ch === "[" || ch === "{") depth++
		else if (ch === ")" || ch === "]" || ch === "}") depth--
		else if (ch === "," && depth === 0) {
			out.push(args.slice(start, i))
			start = i + 1
		}
	}
	out.push(args.slice(start))
	return out.map((p) => p.trim()).filter((p) => p.length > 0)
}

const argValue = (raw: string): unknown => {
	if (
		raw.length > 1 &&
		(raw.startsWith('"') || raw.startsWith("'")) &&
		raw.endsWith(raw[0])
	)
		return raw.slice(1, -1).replace(/\\(.)/g, "$1")
	if (raw === "true" || raw === "True") return true
	if (raw === "false" || raw === "False") return false
	if (raw === "null" || raw === "None") return null
	if (NUMBER_RE.test(raw)) return Number(raw)
	return raw
}

const pythonicArgs = (
	args: string,
	positionalKey: string,
): Record<string, unknown> | null => {
	const parts = splitArgParts(args)
	if (parts.length === 0) return {}
	const keyed = parts.map((p) => KEYWORD_ARG_RE.exec(p))
	if (keyed.every((k) => k !== null))
		return Object.fromEntries(
			keyed.map((k) => [k[1], argValue(k[2].trim())] as const),
		)
	if (parts.length === 1) return { [positionalKey]: argValue(parts[0]) }
	return null
}

const parsePythonicCalls = (
	text: string,
	tools: ToolDefinitionType[],
): ToolCallType[] | null => {
	const segments = pythonicSegments(text)
	if (!segments) return null
	const calls: ToolCallType[] = []
	for (const segment of segments) {
		const tool = tools.find(
			(t) => t.name.toLowerCase() === segment.name.toLowerCase(),
		)
		if (!tool) return null
		const args = pythonicArgs(segment.args.trim(), positionalKeyOf(tool))
		if (!args) return null
		calls.push({ name: tool.name, arguments: args })
	}
	return calls
}

export const parseGrammarDecision = (
	raw: string,
	tools: ToolDefinitionType[],
	model?: string,
): ToolCallOrReplyType | null => {
	const text = raw.trim()
	if (!text) return null
	const body = text.replace(/^;+\s*/, "")
	if (body.startsWith("{")) {
		const calls = splitObjects(body)
			.map((chunk) => callOf(chunk, model))
			.filter((c): c is ToolCallType => c !== null)
		return calls.length > 0 ? { kind: "tool_calls", calls } : null
	}
	const pythonic = parsePythonicCalls(body, tools)
	if (pythonic) return { kind: "tool_calls", calls: pythonic }
	return { kind: "reply", text }
}

export const createGrammarStreamGate = (
	tools: ToolDefinitionType[],
): GrammarStreamGateType => {
	const names = tools.map((t) => t.name.toLowerCase())
	let buffer = ""
	let settled: GrammarStreamVerdictType | null = null

	const decide = (): GrammarStreamVerdictType => {
		const trimmed = buffer.replace(/^\s+/, "")
		if (trimmed.length === 0) return { state: "pending" }
		if (trimmed.startsWith("{") || trimmed.startsWith(";"))
			return { state: "decision" }
		const lower = trimmed.toLowerCase()
		const open = lower.indexOf("(")
		if (open > 0)
			return names.includes(lower.slice(0, open))
				? { state: "decision" }
				: { state: "reply", flush: buffer }
		if (open < 0 && names.some((n) => n.startsWith(lower)))
			return { state: "pending" }
		return { state: "reply", flush: buffer }
	}

	return {
		push: (token: string): GrammarStreamVerdictType => {
			buffer += token
			if (settled)
				return settled.state === "reply"
					? { state: "reply", flush: token }
					: settled
			const verdict = decide()
			if (verdict.state !== "pending") settled = verdict
			return verdict
		},
		end: (): GrammarStreamVerdictType => {
			if (settled) return settled
			settled = { state: "reply", flush: buffer }
			return settled
		},
		buffered: (): string => buffer,
	}
}

const EXTERNAL_DATA_PREFIX = "[external data from "

const callSyntaxOf = (calls: ToolCallType[]): string =>
	calls
		.map((c) => JSON.stringify({ name: c.name, parameters: c.arguments }))
		.join("; ")

const toolResultText = (message: ChatMessageType): string =>
	message.content.startsWith(EXTERNAL_DATA_PREFIX)
		? message.content
		: wrapUntrustedToolOutput(message.toolName ?? "a tool", message.content)
				.text

export const flattenToolHistory = (
	messages: ChatMessageType[],
): ChatMessageType[] =>
	messages.map((m) => {
		if (m.role === "assistant" && m.toolCalls?.length)
			return { role: "assistant", content: callSyntaxOf(m.toolCalls) }
		if (m.role === "tool") return { role: "user", content: toolResultText(m) }
		return m
	})

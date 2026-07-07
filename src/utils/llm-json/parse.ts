import type { z } from "zod"
import { fixJson } from "./fix-json"
import type { ParseLlmJsonResultType } from "./types"

const OPENERS: Record<string, string> = { "{": "}", "[": "]" }

export const extractJsonBlock = (raw: string): string | null => {
	const withoutFences = raw
		.replace(/```(?:json)?/gi, "")
		.replace(/```/g, "")
		.trim()

	let start = -1
	for (let i = 0; i < withoutFences.length; i++) {
		if (withoutFences[i] === "{" || withoutFences[i] === "[") {
			start = i
			break
		}
	}
	if (start === -1) return null

	const open = withoutFences[start]
	const close = OPENERS[open]
	let depth = 0
	let inString = false
	let escaped = false

	for (let i = start; i < withoutFences.length; i++) {
		const char = withoutFences[i]
		if (inString) {
			if (escaped) escaped = false
			else if (char === "\\") escaped = true
			else if (char === '"') inString = false
			continue
		}
		if (char === '"') inString = true
		else if (char === open) depth++
		else if (char === close) {
			depth--
			if (depth === 0) return withoutFences.slice(start, i + 1)
		}
	}

	return withoutFences.slice(start)
}

export const parseLlmJson = <T = Record<string, unknown>>(
	raw: string,
	schema?: z.ZodType<T>,
): ParseLlmJsonResultType<T> => {
	const block = extractJsonBlock(raw)
	if (block === null) return { value: null, state: "failed" }

	const validate = (value: unknown): T | null => {
		if (!schema) return value as T
		const result = schema.safeParse(value)
		return result.success ? result.data : null
	}

	try {
		const parsed = validate(JSON.parse(block))
		if (parsed !== null) return { value: parsed, state: "parsed" }
	} catch {
		/* empty */
	}

	try {
		const repaired = validate(JSON.parse(fixJson(block)))
		if (repaired !== null) return { value: repaired, state: "repaired" }
	} catch {
		/* empty */
	}

	return { value: null, state: "failed" }
}

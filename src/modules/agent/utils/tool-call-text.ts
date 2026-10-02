const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const isToolCallObject = (chunk: string): boolean => {
	try {
		const parsed: unknown = JSON.parse(chunk)
		return (
			isRecord(parsed) &&
			typeof parsed.name === "string" &&
			(isRecord(parsed.parameters) || isRecord(parsed.arguments))
		)
	} catch {
		return false
	}
}

const objectEnd = (text: string, start: number): number => {
	let depth = 0
	let inString = false
	let escaped = false
	for (let i = start; i < text.length; i++) {
		const ch = text[i]
		if (inString) {
			if (escaped) escaped = false
			else if (ch === "\\") escaped = true
			else if (ch === '"') inString = false
			continue
		}
		if (ch === '"') inString = true
		else if (ch === "{") depth++
		else if (ch === "}" && --depth === 0) return i
	}
	return -1
}

export const stripToolCallJson = (text: string): string => {
	const kept: string[] = []
	let cursor = 0
	let scanFrom = 0
	while (scanFrom < text.length) {
		const start = text.indexOf("{", scanFrom)
		if (start < 0) break
		const end = objectEnd(text, start)
		if (end < 0) break
		if (!isToolCallObject(text.slice(start, end + 1))) {
			scanFrom = start + 1
			continue
		}
		kept.push(text.slice(cursor, start))
		cursor = end + 1
		scanFrom = cursor
	}
	if (kept.length === 0) return text.trim()
	kept.push(text.slice(cursor))
	return kept
		.join(" ")
		.replace(/\s+/g, " ")
		.replace(/\s+([.,;:!?])/g, "$1")
		.replace(/^[\s;,]+|[\s;,]+$/g, "")
}

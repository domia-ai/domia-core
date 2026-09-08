const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

export const looksLikeToolCallJson = (text: string): boolean => {
	const trimmed = text.trim()
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false
	try {
		const parsed: unknown = JSON.parse(trimmed)
		if (!isRecord(parsed) || typeof parsed.name !== "string") return false
		return isRecord(parsed.parameters) || isRecord(parsed.arguments)
	} catch {
		return false
	}
}

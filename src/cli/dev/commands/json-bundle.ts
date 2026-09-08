export const unwrapBundle = (raw: string, key: string): unknown => {
	const parsed: unknown = JSON.parse(raw)
	if (typeof parsed !== "object" || parsed === null) return parsed
	const inner = (parsed as Record<string, unknown>)[key]
	return inner ?? parsed
}

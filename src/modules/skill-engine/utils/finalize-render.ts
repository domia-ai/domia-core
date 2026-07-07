const PLACEHOLDER_PATTERN = /\{(\w+)\}/g

const stringArg = (value: unknown): string | null => {
	if (typeof value === "string" && value.trim()) return value.trim()
	if (Array.isArray(value) && value.length > 0) {
		const joined = value
			.filter((v): v is string => typeof v === "string" && v.trim() !== "")
			.join(", ")
		return joined || null
	}
	return null
}

const nameFrom = (
	rawArgs: Record<string, unknown>,
	resolvedArgs?: Record<string, unknown>,
): string | null =>
	stringArg(rawArgs.name) ??
	stringArg(rawArgs.area) ??
	stringArg(resolvedArgs?.name) ??
	stringArg(resolvedArgs?.area)

export const renderFinalizeText = (
	template: string,
	rawArgs: Record<string, unknown>,
	resolvedArgs?: Record<string, unknown>,
): string | null => {
	if (!template.includes("{")) return template
	const valueFor = (key: string): string | null => {
		if (key === "name") return nameFrom(rawArgs, resolvedArgs)
		return stringArg(rawArgs[key]) ?? stringArg(resolvedArgs?.[key])
	}
	let missing = false
	const rendered = template.replace(PLACEHOLDER_PATTERN, (_, key: string) => {
		const value = valueFor(key)
		if (value == null) {
			missing = true
			return ""
		}
		return value
	})
	return missing ? null : rendered
}

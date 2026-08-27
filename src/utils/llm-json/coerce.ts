const schemaTypeOf = (prop: unknown): string | null => {
	if (!prop || typeof prop !== "object") return null
	const t = (prop as { type?: unknown }).type
	if (typeof t === "string") return t
	if (Array.isArray(t)) {
		const first = t.find((x) => typeof x === "string" && x !== "null")
		return typeof first === "string" ? first : null
	}
	return null
}

const itemsOf = (prop: unknown): unknown =>
	prop && typeof prop === "object"
		? ((prop as { items?: unknown }).items ?? null)
		: null

const coerceScalar = (value: unknown, type: string): unknown => {
	if (type === "number" || type === "integer") {
		if (typeof value === "number") return value
		if (typeof value === "string" && value.trim() !== "") {
			const n = Number(value)
			if (Number.isFinite(n)) return type === "integer" ? Math.trunc(n) : n
		}
		return value
	}
	if (type === "boolean") {
		if (typeof value === "boolean") return value
		if (value === "true") return true
		if (value === "false") return false
		return value
	}
	if (type === "string" && typeof value === "string") return value.trim()
	return value
}

const parseJsonContainer = (value: string): unknown | undefined => {
	const trimmed = value.trim()
	if (!/^[[{]/.test(trimmed)) return undefined
	try {
		return JSON.parse(trimmed) as unknown
	} catch {
		return undefined
	}
}

const coerceValue = (value: unknown, prop: unknown): unknown => {
	const type = schemaTypeOf(prop)
	if (!type) return value
	if (type === "array") {
		let v = value
		if (typeof v === "string") {
			const parsed = parseJsonContainer(v)
			if (Array.isArray(parsed)) v = parsed
		}
		if (!Array.isArray(v)) v = [v]
		const items = itemsOf(prop)
		return (v as unknown[]).map((item) => {
			if (typeof item === "string") {
				const itemType = schemaTypeOf(items)
				if (itemType === "object" || itemType === "array") {
					const parsed = parseJsonContainer(item)
					if (parsed !== undefined) return parsed
				}
				return items ? coerceValue(item, items) : item
			}
			return items ? coerceValue(item, items) : item
		})
	}
	if (type === "object") {
		if (typeof value === "string") {
			const parsed = parseJsonContainer(value)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
				return parsed
		}
		return value
	}
	return coerceScalar(value, type)
}

export const coerceArgsToSchema = (
	args: Record<string, unknown>,
	inputSchema: Record<string, unknown> | undefined,
): Record<string, unknown> => {
	const props = inputSchema?.properties as Record<string, unknown> | undefined
	if (!props) return args
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(args))
		out[k] = k in props ? coerceValue(v, props[k]) : v
	return out
}

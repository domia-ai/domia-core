export const sanitizeJsonSchema = (
	schema: Record<string, unknown>,
): Record<string, unknown> | null => {
	const clean = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(clean)
		if (!node || typeof node !== "object") return node
		const obj = { ...(node as Record<string, unknown>) }
		if (Array.isArray(obj.type)) {
			const first = (obj.type as unknown[]).find(
				(t) => typeof t === "string" && t !== "null",
			)
			if (typeof first === "string") obj.type = first
			else return null
		}
		if (obj.anyOf || obj.oneOf) {
			const variants = (obj.anyOf ?? obj.oneOf) as unknown[]
			const nonNull = variants.find(
				(v) =>
					v &&
					typeof v === "object" &&
					(v as { type?: unknown }).type !== "null",
			)
			if (nonNull) return clean(nonNull)
			return null
		}
		delete obj.$ref
		delete obj.default
		if (obj.properties && typeof obj.properties === "object") {
			const props: Record<string, unknown> = {}
			for (const [k, v] of Object.entries(
				obj.properties as Record<string, unknown>,
			)) {
				const cleaned = clean(v)
				if (cleaned !== null) props[k] = cleaned
			}
			obj.properties = props
		}
		if (obj.items && typeof obj.items === "object") {
			const cleaned = clean(obj.items)
			if (cleaned === null) delete obj.items
			else obj.items = cleaned
		}
		return obj
	}
	const result = clean(schema)
	if (!result || typeof result !== "object") return null
	const root = result as Record<string, unknown>
	if (root.type !== "object") return null
	const props = root.properties as Record<string, unknown> | undefined
	if (!props || Object.keys(props).length === 0) return null
	return root
}

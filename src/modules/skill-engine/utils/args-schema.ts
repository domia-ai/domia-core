import { DOMIA_PLACEHOLDER_RE } from "../specializations/domia/constants"

export const WHOLE_PLACEHOLDER_RE = /^\{(\w+)\}$/

const jsonTypeMatches = (expected: unknown, value: unknown): boolean => {
	if (Array.isArray(expected))
		return expected.some((t) => jsonTypeMatches(t, value))
	switch (expected) {
		case "string":
			return typeof value === "string"
		case "number":
			return typeof value === "number"
		case "integer":
			return Number.isInteger(value)
		case "boolean":
			return typeof value === "boolean"
		case "array":
			return Array.isArray(value)
		case "object":
			return (
				value !== null && typeof value === "object" && !Array.isArray(value)
			)
		case "null":
			return value === null
		default:
			return true
	}
}

const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?$/

const numericKinds = (expected: unknown): boolean =>
	(Array.isArray(expected) ? expected : [expected]).some(
		(t) => t === "number" || t === "integer",
	)

const coerceNumericString = (expected: unknown, value: unknown): unknown =>
	typeof value === "string" &&
	NUMERIC_STRING_RE.test(value) &&
	numericKinds(expected)
		? Number(value)
		: value

export const coerceArgsToSchema = (
	args: Record<string, unknown>,
	schema: Record<string, unknown>,
): Record<string, unknown> => {
	const props =
		schema.properties && typeof schema.properties === "object"
			? (schema.properties as Record<string, unknown>)
			: null
	if (!props) return args
	return Object.fromEntries(
		Object.entries(args).map(([key, value]) => {
			const prop = props[key]
			const expected =
				prop && typeof prop === "object" && "type" in prop
					? prop.type
					: undefined
			return [key, coerceNumericString(expected, value)]
		}),
	)
}

export const placeholdersIn = (value: unknown): string[] => {
	if (typeof value === "string")
		return [...value.matchAll(DOMIA_PLACEHOLDER_RE)].map((m) => m[1])
	if (Array.isArray(value)) return value.flatMap(placeholdersIn)
	if (value !== null && typeof value === "object")
		return Object.values(value).flatMap(placeholdersIn)
	return []
}

export const argsSchemaIssue = (
	args: Record<string, unknown>,
	schema: Record<string, unknown>,
	placeholders: Set<string> | null = null,
): string | null => {
	const props =
		schema.properties && typeof schema.properties === "object"
			? (schema.properties as Record<string, unknown>)
			: null
	if (props && placeholders)
		for (const key of Object.keys(args))
			if (!(key in props)) return `unknown argument "${key}"`
	const required = Array.isArray(schema.required) ? schema.required : []
	for (const key of required)
		if (typeof key === "string" && !(key in args))
			return `missing required argument "${key}"`
	if (placeholders)
		for (const name of placeholdersIn(args))
			if (!placeholders.has(name)) return `unknown placeholder {${name}}`
	for (const [key, value] of Object.entries(args)) {
		if (
			placeholders &&
			typeof value === "string" &&
			WHOLE_PLACEHOLDER_RE.test(value)
		)
			continue
		const prop = props?.[key]
		const expected =
			prop && typeof prop === "object" && "type" in prop ? prop.type : undefined
		if (
			expected !== undefined &&
			!jsonTypeMatches(expected, coerceNumericString(expected, value))
		)
			return `argument "${key}" does not match type ${JSON.stringify(expected)}`
	}
	return null
}

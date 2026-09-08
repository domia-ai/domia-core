import { toolBaseName } from "./tool-name"
import type { ArgNormalizeMapType, ArgNormalizeOpType } from "@/db"

const NUMERIC_PREFIX_RE = /^\s*(-?\d+(?:[.,]\d+)?)/
const TRUE_WORDS = new Set(["true", "yes", "on", "1", "si", "sí"])
const FALSE_WORDS = new Set(["false", "no", "off", "0"])

const toNumber = (value: unknown): number | null => {
	if (typeof value === "number") return Number.isFinite(value) ? value : null
	if (typeof value !== "string") return null
	const match = NUMERIC_PREFIX_RE.exec(value)
	if (!match) return null
	const parsed = Number(match[1].replace(",", "."))
	return Number.isFinite(parsed) ? parsed : null
}

const mapNumber = (value: unknown, fn: (n: number) => number): unknown => {
	const n = toNumber(value)
	return n === null ? value : fn(n)
}

const applyOp = (value: unknown, op: ArgNormalizeOpType): unknown => {
	switch (op) {
		case "trim":
			return typeof value === "string" ? value.trim() : value
		case "lowercase":
			return typeof value === "string" ? value.toLowerCase() : value
		case "uppercase":
			return typeof value === "string" ? value.toUpperCase() : value
		case "collapseSpaces":
			return typeof value === "string"
				? value.replace(/\s+/g, " ").trim()
				: value
		case "number":
			return mapNumber(value, (n) => n)
		case "integer":
			return mapNumber(value, (n) => Math.round(n))
		case "boolean": {
			if (typeof value === "boolean") return value
			if (typeof value === "number") return value !== 0
			if (typeof value !== "string") return value
			const word = value.trim().toLowerCase()
			if (TRUE_WORDS.has(word)) return true
			if (FALSE_WORDS.has(word)) return false
			return value
		}
		case "string":
			return typeof value === "number" || typeof value === "boolean"
				? String(value)
				: value
		case "stringList":
			if (Array.isArray(value)) return value
			return typeof value === "string"
				? value
						.split(/[,;]/)
						.map((s) => s.trim())
						.filter((s) => s.length > 0)
				: value
		case "stripUnits":
			return typeof value === "string" ? mapNumber(value, (n) => n) : value
		case "percentToFraction":
			return mapNumber(value, (n) => (n > 1 ? n / 100 : n))
		case "fractionToPercent":
			return mapNumber(value, (n) => (n <= 1 ? Math.round(n * 100) : n))
		case "fahrenheitToCelsius":
			return mapNumber(value, (n) => Math.round((((n - 32) * 5) / 9) * 10) / 10)
		case "celsiusToFahrenheit":
			return mapNumber(value, (n) => Math.round(((n * 9) / 5 + 32) * 10) / 10)
	}
}

const opsFor = (
	map: ArgNormalizeMapType,
	rawName: string,
	arg: string,
): ArgNormalizeOpType[] => {
	const loose = map as Partial<
		Record<string, Partial<Record<string, ArgNormalizeOpType[]>>>
	>
	const forTool = loose[rawName] ?? loose[toolBaseName(rawName)] ?? {}
	const forAll = loose["*"] ?? {}
	return forTool[arg] ?? forTool["*"] ?? forAll[arg] ?? forAll["*"] ?? []
}

export const normalizeArgs = (
	map: ArgNormalizeMapType,
	rawName: string,
	args: Record<string, unknown>,
): Record<string, unknown> => {
	if (Object.keys(map).length === 0) return args
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(args)) {
		let current = value
		for (const op of opsFor(map, rawName, key)) current = applyOp(current, op)
		out[key] = current
	}
	return out
}

import { createHash } from "crypto"

const sortValue = (v: unknown): unknown => {
	if (Array.isArray(v)) return v.map(sortValue)
	if (v !== null && typeof v === "object") {
		const out: Record<string, unknown> = {}
		for (const k of Object.keys(v as Record<string, unknown>).sort())
			out[k] = sortValue((v as Record<string, unknown>)[k])
		return out
	}
	return v
}

export const canonicalJson = (v: unknown): string =>
	JSON.stringify(sortValue(v))

export const hashCanonical = (v: unknown): string =>
	createHash("sha256").update(canonicalJson(v)).digest("hex").slice(0, 16)

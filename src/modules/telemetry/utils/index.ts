import { createHash, randomBytes } from "crypto"

import type { DomiaIdGeneratorType } from "../types"

const HEX_32 = /^[0-9a-f]{32}$/

export const otelTraceIdFromDomia = (
	traceId: string | undefined,
): string | null => {
	if (!traceId) return null
	const compact = traceId.replace(/-/g, "").toLowerCase()
	if (HEX_32.test(compact)) return compact
	return createHash("sha256").update(traceId).digest("hex").slice(0, 32)
}

export const createDomiaIdGenerator = (): DomiaIdGeneratorType => {
	let pending: string | null = null
	return {
		generateTraceId: () => pending ?? randomBytes(16).toString("hex"),
		generateSpanId: () => randomBytes(8).toString("hex"),
		withTraceId: (traceIdHex, fn) => {
			pending = traceIdHex
			try {
				return fn()
			} finally {
				pending = null
			}
		},
	}
}

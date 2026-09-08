import { AsyncLocalStorage } from "async_hooks"
import { randomUUID } from "crypto"

import type { TraceContextType } from "./types"

const TRACE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/

const traceContextStore = new AsyncLocalStorage<TraceContextType>()

export const getTraceContext = (): TraceContextType | undefined =>
	traceContextStore.getStore()

export const runWithTraceContext = <T>(ctx: TraceContextType, fn: () => T): T =>
	traceContextStore.run(ctx, fn)

export const setTraceContext = (ctx: TraceContextType): void => {
	const current = traceContextStore.getStore() ?? {}
	traceContextStore.enterWith({ ...current, ...ctx })
}

export const ensureTraceId = (incoming?: unknown): string => {
	if (typeof incoming === "string") {
		const candidate = incoming.trim()
		if (TRACE_ID_RE.test(candidate)) return candidate
	}
	return randomUUID()
}

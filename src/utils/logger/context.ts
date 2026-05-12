import { AsyncLocalStorage } from "async_hooks"

import type { TraceContextType } from "./types"

const traceContextStore = new AsyncLocalStorage<TraceContextType>()

export const getTraceContext = (): TraceContextType | undefined =>
	traceContextStore.getStore()

export const runWithTraceContext = <T>(ctx: TraceContextType, fn: () => T): T =>
	traceContextStore.run(ctx, fn)

export const setTraceContext = (ctx: TraceContextType): void => {
	const current = traceContextStore.getStore() ?? {}
	traceContextStore.enterWith({ ...current, ...ctx })
}

export const clearTraceContext = (): void => {
	traceContextStore.enterWith({})
}

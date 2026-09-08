import type { Tracer } from "@opentelemetry/api"

import type { DomiaTurnEventType } from "@/buses"

export type TurnRecordType = {
	interactionId: string
	originDomiaKey: string
	executorDomiaKey?: string
	satelliteId?: string
	traceId?: string
	startedAt: number
	events: DomiaTurnEventType[]
}

export type DomiaIdGeneratorType = {
	generateTraceId: () => string
	generateSpanId: () => string
	withTraceId: <T>(traceIdHex: string | null, fn: () => T) => T
}

export type TurnSpanBridgeArgsType = {
	tracer: Tracer
	idGenerator: DomiaIdGeneratorType
	lruMax?: number
}

export type TurnSpanBridgeType = {
	stop: () => void
	openTurns: () => number
}

export type SpanAttributesType = Record<
	string,
	string | number | boolean | string[]
>

export type ChildSpanSpecType = {
	name: string
	start: number
	end: number
	attributes: SpanAttributesType
	error?: string
	events?: { name: string; at: number }[]
}

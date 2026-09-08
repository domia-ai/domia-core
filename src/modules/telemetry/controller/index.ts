import { context, SpanStatusCode, trace, type Span } from "@opentelemetry/api"

import { onTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import type { DomiaTurnEventType } from "@/buses"
import { otelLogger } from "@/utils"
import {
	ATTR,
	GEN_AI_OPERATION_CHAT,
	GEN_AI_OPERATION_TOOL,
	OTEL_TURN_LRU_MAX,
	SPAN_NAMES,
} from "../constants"
import type {
	ChildSpanSpecType,
	SpanAttributesType,
	TurnRecordType,
	TurnSpanBridgeArgsType,
	TurnSpanBridgeType,
} from "../types"
import { otelTraceIdFromDomia } from "../utils"

const TERMINAL_TYPES = new Set<DOMIA_TURN_EVENT_ENUM>([
	DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED,
	DOMIA_TURN_EVENT_ENUM.TURN_FAILED,
	DOMIA_TURN_EVENT_ENUM.TURN_ABORTED,
])

const defined = (attrs: Record<string, unknown>): SpanAttributesType =>
	Object.fromEntries(
		Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null),
	) as SpanAttributesType

const firstOf = <K extends DOMIA_TURN_EVENT_ENUM>(
	events: DomiaTurnEventType[],
	type: K,
): Extract<DomiaTurnEventType, { type: K }> | undefined =>
	events.find(
		(e): e is Extract<DomiaTurnEventType, { type: K }> => e.type === type,
	)

const clampEnd = (start: number, end: number): number => Math.max(start, end)

const sttSpan = (
	events: DomiaTurnEventType[],
	startedAt: number,
): ChildSpanSpecType | null => {
	const sttFinal = firstOf(events, DOMIA_TURN_EVENT_ENUM.STT_FINAL)
	if (!sttFinal) return null
	return {
		name: SPAN_NAMES.STT,
		start: startedAt,
		end: clampEnd(startedAt, sttFinal.ts),
		attributes: defined({
			[ATTR.STT_TRANSCRIPT_CHARS]: sttFinal.transcript.length,
			[ATTR.STT_SPECULATIVE]: sttFinal.speculative ?? false,
		}),
	}
}

const intentSpan = (events: DomiaTurnEventType[]): ChildSpanSpecType | null => {
	const intent = firstOf(events, DOMIA_TURN_EVENT_ENUM.INTENT_DECIDED)
	if (!intent) return null
	return {
		name: SPAN_NAMES.INTENT,
		start: intent.ts - (intent.intentMs ?? 0),
		end: intent.ts,
		attributes: defined({ [ATTR.INTENT_DECISION]: intent.decision }),
	}
}

const llmSpan = (
	events: DomiaTurnEventType[],
	startedAt: number,
): { spec: ChildSpanSpecType | null; llmEnd: number | undefined } => {
	const llmDone = firstOf(events, DOMIA_TURN_EVENT_ENUM.LLM_DONE)
	if (!llmDone) return { spec: null, llmEnd: undefined }
	const intent = firstOf(events, DOMIA_TURN_EVENT_ENUM.INTENT_DECIDED)
	const sttFinal = firstOf(events, DOMIA_TURN_EVENT_ENUM.STT_FINAL)
	const firstSentence = firstOf(
		events,
		DOMIA_TURN_EVENT_ENUM.LLM_FIRST_SENTENCE,
	)
	const llmStart = Math.max(
		startedAt,
		intent?.ts ?? startedAt,
		sttFinal?.ts ?? startedAt,
	)
	const llmEnd = llmStart + (llmDone.llmMs ?? 0)
	return {
		llmEnd,
		spec: {
			name: SPAN_NAMES.LLM,
			start: llmStart,
			end: llmEnd,
			attributes: defined({
				[ATTR.GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_CHAT,
				[ATTR.GEN_AI_USAGE_INPUT_TOKENS]: llmDone.promptTokens,
				[ATTR.GEN_AI_USAGE_OUTPUT_TOKENS]: llmDone.completionTokens,
				[ATTR.GEN_AI_RESPONSE_FINISH_REASONS]: llmDone.finishReason
					? [llmDone.finishReason]
					: undefined,
				[ATTR.LLM_QUEUE_MS]: llmDone.llmQueueMs,
				[ATTR.LLM_FIRST_SENTENCE_MS]: firstSentence?.elapsedMs,
			}),
			events: firstSentence
				? [
						{
							name: DOMIA_TURN_EVENT_ENUM.LLM_FIRST_SENTENCE,
							at: firstSentence.ts,
						},
					]
				: undefined,
		},
	}
}

const toolSpans = (events: DomiaTurnEventType[]): ChildSpanSpecType[] => {
	const specs: ChildSpanSpecType[] = []
	const openTools = new Map<
		string,
		Extract<DomiaTurnEventType, { type: DOMIA_TURN_EVENT_ENUM.TOOL_STARTED }>[]
	>()
	for (const e of events) {
		if (e.type === DOMIA_TURN_EVENT_ENUM.TOOL_STARTED) {
			const list = openTools.get(e.toolName) ?? []
			list.push(e)
			openTools.set(e.toolName, list)
		}
		if (e.type === DOMIA_TURN_EVENT_ENUM.TOOL_RESULT) {
			const started = openTools.get(e.toolName)?.shift()
			const start = started?.ts ?? e.ts - (e.toolMs ?? e.durationMs ?? 0)
			specs.push({
				name: `${SPAN_NAMES.TOOL} ${e.toolName}`,
				start,
				end: clampEnd(start, e.ts),
				attributes: defined({
					[ATTR.GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_TOOL,
					[ATTR.GEN_AI_TOOL_NAME]: e.toolName,
					[ATTR.TOOL_PROVIDER]: started?.provider,
					[ATTR.TOOL_RISK_CLASS]: started?.riskClass,
					[ATTR.TOOL_POLICY_DECISION]: started?.policyDecision,
					[ATTR.TOOL_STATUS]: e.status,
				}),
				error: e.status === "ok" ? undefined : `tool ${e.status}`,
			})
		}
	}
	return specs
}

const ttsSpan = (
	events: DomiaTurnEventType[],
	ttsStart: number | undefined,
): ChildSpanSpecType | null => {
	const ttsFirst = firstOf(events, DOMIA_TURN_EVENT_ENUM.TTS_FIRST_AUDIO)
	const playbackStarted = firstOf(
		events,
		DOMIA_TURN_EVENT_ENUM.PLAYBACK_STARTED,
	)
	const completed = firstOf(events, DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED)
	if (ttsStart === undefined || !(ttsFirst ?? playbackStarted ?? completed))
		return null
	const ttsEnd =
		playbackStarted?.ts ??
		(completed?.ttsMs !== undefined ? ttsStart + completed.ttsMs : undefined) ??
		ttsFirst?.ts ??
		ttsStart
	return {
		name: SPAN_NAMES.TTS,
		start: ttsStart,
		end: clampEnd(ttsStart, ttsEnd),
		attributes: defined({
			[ATTR.TTS_FIRST_CHUNK_MS]: ttsFirst?.ttsFirstChunkMs,
		}),
		events: ttsFirst
			? [{ name: DOMIA_TURN_EVENT_ENUM.TTS_FIRST_AUDIO, at: ttsFirst.ts }]
			: undefined,
	}
}

const playbackSpan = (
	events: DomiaTurnEventType[],
): ChildSpanSpecType | null => {
	const playbackStarted = firstOf(
		events,
		DOMIA_TURN_EVENT_ENUM.PLAYBACK_STARTED,
	)
	if (!playbackStarted) return null
	const playbackFinished = firstOf(
		events,
		DOMIA_TURN_EVENT_ENUM.PLAYBACK_FINISHED,
	)
	return {
		name: SPAN_NAMES.PLAYBACK,
		start: playbackStarted.ts,
		end: clampEnd(
			playbackStarted.ts,
			playbackFinished?.ts ?? events[events.length - 1].ts,
		),
		attributes: defined({
			[ATTR.PLAYBACK_STATUS]: playbackFinished?.status,
			[ATTR.PLAYBACK_LOCAL]:
				playbackFinished?.playedLocally ?? playbackStarted.playedLocally,
		}),
	}
}

const stageSpans = (events: DomiaTurnEventType[]): ChildSpanSpecType[] => {
	const specs: ChildSpanSpecType[] = []
	const openStages = new Map<string, number>()
	for (const e of events) {
		if (e.type === DOMIA_TURN_EVENT_ENUM.STAGE_STARTED)
			openStages.set(e.stageName, e.ts)
		if (e.type === DOMIA_TURN_EVENT_ENUM.STAGE_DONE) {
			const start = openStages.get(e.stageName) ?? e.ts - e.elapsedMs
			openStages.delete(e.stageName)
			specs.push({
				name: `${SPAN_NAMES.STAGE_PREFIX}${e.stageName}`,
				start,
				end: clampEnd(start, e.ts),
				attributes: defined({ [ATTR.STAGE_STATUS]: e.status }),
				error: e.status === "failed" ? (e.errorMessage ?? "failed") : undefined,
			})
		}
	}
	return specs
}

const pipelineSpans = (record: TurnRecordType): ChildSpanSpecType[] => {
	const { events, startedAt } = record
	const firstSentence = firstOf(
		events,
		DOMIA_TURN_EVENT_ENUM.LLM_FIRST_SENTENCE,
	)
	const llm = llmSpan(events, startedAt)
	const ttsStart = firstSentence?.ts ?? llm.llmEnd
	return [
		sttSpan(events, startedAt),
		intentSpan(events),
		llm.spec,
		...toolSpans(events),
		ttsSpan(events, ttsStart),
		playbackSpan(events),
		...stageSpans(events),
	].filter((s): s is ChildSpanSpecType => s !== null)
}

const rootAttributes = (record: TurnRecordType): SpanAttributesType => {
	const started = firstOf(record.events, DOMIA_TURN_EVENT_ENUM.TURN_STARTED)
	const completed = firstOf(record.events, DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED)
	const failed = firstOf(record.events, DOMIA_TURN_EVENT_ENUM.TURN_FAILED)
	const aborted = firstOf(record.events, DOMIA_TURN_EVENT_ENUM.TURN_ABORTED)
	const terminal = completed ?? failed ?? aborted
	return defined({
		[ATTR.INTERACTION_ID]: record.interactionId,
		[ATTR.ORIGIN_DOMIA_KEY]: record.originDomiaKey,
		[ATTR.EXECUTOR_DOMIA_KEY]: record.executorDomiaKey,
		[ATTR.SATELLITE_ID]: record.satelliteId,
		[ATTR.TRACE_ID]: record.traceId,
		[ATTR.TURN_INPUT_TYPE]: started?.inputType,
		[ATTR.TURN_SOURCE]: started?.source,
		[ATTR.TURN_STATUS]:
			completed?.status ??
			(failed ? "failed" : aborted ? "aborted" : undefined),
		[ATTR.TURN_INCOMPLETE]: terminal ? undefined : true,
		[ATTR.TURN_TTFA_MS]: completed?.ttfaMs,
		[ATTR.TURN_PERCEIVED_TTFA_MS]: completed?.perceivedTtfaMs,
		[ATTR.TURN_TOTAL_MS]: completed?.totalMs,
		[ATTR.TURN_ABORT_REASON]: aborted?.reason,
		[ATTR.TURN_FAILED_STEP]: failed?.step,
		[ATTR.TURN_ERROR_CODE]: failed?.errorCode,
	})
}

const applyError = (span: Span, message: string | undefined): void => {
	if (message === undefined) return
	span.setStatus({ code: SpanStatusCode.ERROR, message })
}

export const createTurnSpanBridge = ({
	tracer,
	idGenerator,
	lruMax = OTEL_TURN_LRU_MAX,
}: TurnSpanBridgeArgsType): TurnSpanBridgeType => {
	const turns = new Map<string, TurnRecordType>()

	const materialize = (record: TurnRecordType): void => {
		const last = record.events[record.events.length - 1]
		const failed = firstOf(record.events, DOMIA_TURN_EVENT_ENUM.TURN_FAILED)
		const root = idGenerator.withTraceId(
			otelTraceIdFromDomia(record.traceId),
			() =>
				tracer.startSpan(SPAN_NAMES.TURN, {
					startTime: record.startedAt,
					attributes: rootAttributes(record),
				}),
		)
		applyError(root, failed?.errorMessage)
		const parent = trace.setSpan(context.active(), root)
		for (const e of record.events) {
			if (
				e.type === DOMIA_TURN_EVENT_ENUM.ENDPOINT_ACCEPTED ||
				e.type === DOMIA_TURN_EVENT_ENUM.SPECULATION_STARTED ||
				e.type === DOMIA_TURN_EVENT_ENUM.SPECULATION_COMMITTED ||
				e.type === DOMIA_TURN_EVENT_ENUM.SPECULATION_DISCARDED
			)
				root.addEvent(e.type, undefined, e.ts)
		}
		for (const spec of pipelineSpans(record)) {
			const child = tracer.startSpan(
				spec.name,
				{ startTime: spec.start, attributes: spec.attributes },
				parent,
			)
			for (const ev of spec.events ?? [])
				child.addEvent(ev.name, undefined, ev.at)
			applyError(child, spec.error)
			child.end(spec.end)
		}
		root.end(last.ts)
	}

	const evictOldest = (): void => {
		const oldest = turns.keys().next().value
		if (oldest === undefined) return
		const record = turns.get(oldest)
		turns.delete(oldest)
		if (record) materialize(record)
	}

	const unsubscribe = onTurnEvent("*", (event) => {
		let record = turns.get(event.interactionId)
		if (!record) {
			if (turns.size >= lruMax) evictOldest()
			record = {
				interactionId: event.interactionId,
				originDomiaKey: event.originDomiaKey,
				executorDomiaKey: event.executorDomiaKey,
				satelliteId: event.satelliteId,
				traceId: event.traceId,
				startedAt: event.ts,
				events: [],
			}
			turns.set(event.interactionId, record)
		}
		record.traceId ??= event.traceId
		record.executorDomiaKey ??= event.executorDomiaKey
		record.satelliteId ??= event.satelliteId
		record.events.push(event)
		if (!TERMINAL_TYPES.has(event.type)) return
		turns.delete(event.interactionId)
		try {
			materialize(record)
		} catch (err) {
			otelLogger.warn("turn span materialization failed", {
				interactionId: event.interactionId,
				err,
			})
		}
	})

	const stop = (): void => {
		unsubscribe()
		for (const record of turns.values()) {
			try {
				materialize(record)
			} catch (err) {
				otelLogger.warn("open turn span materialization failed", {
					interactionId: record.interactionId,
					err,
				})
			}
		}
		turns.clear()
	}

	return { stop, openTurns: () => turns.size }
}

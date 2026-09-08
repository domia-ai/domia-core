import { randomUUID } from "crypto"

import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
	type ReadableSpan,
} from "@opentelemetry/sdk-trace-base"

import { SpanStatusCode } from "@opentelemetry/api"

import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import { setupOtel } from "@/setups/otel"
import {
	createTurnSpanBridge,
	createDomiaIdGenerator,
	otelTraceIdFromDomia,
	ATTR,
	OTEL_TRACER_NAME,
	SPAN_NAMES,
} from "@/modules/telemetry"
import { getBaseDomia } from "@/test-utils"

import { makeChecker } from "./lib"

const checker = makeChecker()
const { check } = checker

const flush = (): Promise<void> =>
	new Promise((resolve) => setImmediate(() => setImmediate(resolve)))

const sdkLoaded = (): boolean =>
	Object.keys(require.cache).some((k) => k.includes("sdk-trace-base"))

const spanByName = (
	spans: ReadableSpan[],
	name: string,
): ReadableSpan | undefined => spans.find((s) => s.name === name)

const offChecks = async (): Promise<void> => {
	console.log("\n== off: nothing loaded ==")
	const handle = await setupOtel({
		exporterUrl: undefined,
		serviceName: "domia-core",
		principalDomiaKey: "DOMIA_EVAL",
	})
	check("setupOtel returns null without exporter url", handle === null)
}

const syntheticTurn = async (): Promise<void> => {
	console.log("\n== one synthetic turn → spans ==")
	const exporter = new InMemorySpanExporter()
	const idGenerator = createDomiaIdGenerator()
	const provider = new BasicTracerProvider({
		idGenerator,
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	})
	const bridge = createTurnSpanBridge({
		tracer: provider.getTracer(OTEL_TRACER_NAME),
		idGenerator,
	})

	const domia = getBaseDomia()
	const originDomiaKey = domia.domiaKey
	const interactionId = randomUUID()
	const traceId = randomUUID()
	const envelope = { interactionId, originDomiaKey, traceId }
	const executorDomiaKey = "DOMIA_EXECUTOR"

	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.TURN_STARTED,
		inputType: "voice",
		source: "http",
	})
	emitTurnEvent({ ...envelope, type: DOMIA_TURN_EVENT_ENUM.ENDPOINT_ACCEPTED })
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.STAGE_STARTED,
		stageName: "context",
	})
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.STAGE_DONE,
		stageName: "context",
		elapsedMs: 3,
		status: "ok",
	})
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.STT_FINAL,
		transcript: "turn on the kitchen light",
	})
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.INTENT_DECIDED,
		decision: "skill",
		intentMs: 12,
	})
	emitTurnEvent({
		...envelope,
		executorDomiaKey,
		type: DOMIA_TURN_EVENT_ENUM.TOOL_STARTED,
		toolName: "ha__light_turn_on",
		provider: "ha",
		riskClass: "low",
		policyDecision: "allow",
	})
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.TOOL_RESULT,
		toolName: "ha__light_turn_on",
		status: "ok",
		toolMs: 40,
	})
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.LLM_FIRST_SENTENCE,
		elapsedMs: 210,
	})
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.TTS_FIRST_AUDIO,
		ttsFirstChunkMs: 95,
	})
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.PLAYBACK_STARTED,
		playedLocally: true,
	})
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.PLAYBACK_FINISHED,
		status: "completed",
		playedLocally: true,
	})
	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.LLM_DONE,
		llmMs: 480,
		llmQueueMs: 5,
		promptTokens: 321,
		completionTokens: 17,
		finishReason: "stop",
	})
	await flush()
	check(
		"no spans before the terminal event",
		exporter.getFinishedSpans().length === 0,
	)
	check("bridge tracks the open turn", bridge.openTurns() === 1)

	emitTurnEvent({
		...envelope,
		type: DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED,
		status: "ok",
		ttfaMs: 620,
		perceivedTtfaMs: 590,
		llmMs: 480,
		ttsMs: 120,
		totalMs: 900,
	})
	await flush()

	const spans = exporter.getFinishedSpans()
	const names = spans.map((s) => s.name)
	check("bridge released the turn", bridge.openTurns() === 0)
	check(
		"root turn span exported",
		spanByName(spans, SPAN_NAMES.TURN) !== undefined,
		names.join(","),
	)
	const root = spanByName(spans, SPAN_NAMES.TURN)
	const expectedTraceId = otelTraceIdFromDomia(traceId)
	check(
		"otel trace id derived from domia traceId",
		root?.spanContext().traceId === expectedTraceId,
		`${root?.spanContext().traceId} vs ${expectedTraceId}`,
	)
	check(
		"every span shares the turn's trace id",
		spans.every((s) => s.spanContext().traceId === expectedTraceId),
	)
	check(
		"root carries interactionId / originDomiaKey / traceId / executor",
		root?.attributes[ATTR.INTERACTION_ID] === interactionId &&
			root.attributes[ATTR.ORIGIN_DOMIA_KEY] === originDomiaKey &&
			root.attributes[ATTR.TRACE_ID] === traceId &&
			root.attributes[ATTR.EXECUTOR_DOMIA_KEY] === executorDomiaKey,
		JSON.stringify(root?.attributes),
	)
	check(
		"root carries turn status + timings",
		root?.attributes[ATTR.TURN_STATUS] === "ok" &&
			root.attributes[ATTR.TURN_TTFA_MS] === 620 &&
			root.attributes[ATTR.TURN_TOTAL_MS] === 900 &&
			root.attributes[ATTR.TURN_INPUT_TYPE] === "voice" &&
			root.attributes[ATTR.TURN_SOURCE] === "http" &&
			root.attributes[ATTR.TURN_INCOMPLETE] === undefined,
	)
	check(
		"root records endpoint.accepted as a span event",
		root?.events.some(
			(e) => e.name === (DOMIA_TURN_EVENT_ENUM.ENDPOINT_ACCEPTED as string),
		) ?? false,
	)
	for (const name of [
		SPAN_NAMES.STT,
		SPAN_NAMES.INTENT,
		SPAN_NAMES.LLM,
		SPAN_NAMES.TTS,
		SPAN_NAMES.PLAYBACK,
		`${SPAN_NAMES.STAGE_PREFIX}context`,
		`${SPAN_NAMES.TOOL} ha__light_turn_on`,
	])
		check(
			`stage span: ${name}`,
			spanByName(spans, name) !== undefined,
			names.join(","),
		)
	const rootSpanId = root?.spanContext().spanId
	check(
		"stage spans are children of the turn span",
		spans
			.filter((s) => s.name !== SPAN_NAMES.TURN)
			.every((s) => s.parentSpanContext?.spanId === rootSpanId),
	)
	const llm = spanByName(spans, SPAN_NAMES.LLM)
	check(
		"llm span: GenAI semconv token split",
		llm?.attributes[ATTR.GEN_AI_OPERATION_NAME] === "chat" &&
			llm.attributes[ATTR.GEN_AI_USAGE_INPUT_TOKENS] === 321 &&
			llm.attributes[ATTR.GEN_AI_USAGE_OUTPUT_TOKENS] === 17 &&
			JSON.stringify(llm.attributes[ATTR.GEN_AI_RESPONSE_FINISH_REASONS]) ===
				JSON.stringify(["stop"]),
		JSON.stringify(llm?.attributes),
	)
	check(
		"llm span: duration equals llmMs",
		llm !== undefined &&
			Math.round(llm.duration[0] * 1000 + llm.duration[1] / 1e6) === 480,
		String(llm?.duration),
	)
	const tool = spanByName(spans, `${SPAN_NAMES.TOOL} ha__light_turn_on`)
	check(
		"tool span: name / provider / policy / status",
		tool?.attributes[ATTR.GEN_AI_TOOL_NAME] === "ha__light_turn_on" &&
			tool.attributes[ATTR.TOOL_PROVIDER] === "ha" &&
			tool.attributes[ATTR.TOOL_POLICY_DECISION] === "allow" &&
			tool.attributes[ATTR.TOOL_STATUS] === "ok" &&
			tool.attributes[ATTR.GEN_AI_OPERATION_NAME] === "execute_tool",
		JSON.stringify(tool?.attributes),
	)
	const stt = spanByName(spans, SPAN_NAMES.STT)
	check(
		"stt span: transcript length, no transcript text",
		stt?.attributes[ATTR.STT_TRANSCRIPT_CHARS] ===
			"turn on the kitchen light".length &&
			!JSON.stringify(stt.attributes).includes("kitchen"),
	)
	const intent = spanByName(spans, SPAN_NAMES.INTENT)
	check(
		"intent span: decision",
		intent?.attributes[ATTR.INTENT_DECISION] === "skill",
	)
	const tts = spanByName(spans, SPAN_NAMES.TTS)
	check(
		"tts span: first chunk attr + first_audio event",
		tts?.attributes[ATTR.TTS_FIRST_CHUNK_MS] === 95 &&
			tts.events.some(
				(e) => e.name === (DOMIA_TURN_EVENT_ENUM.TTS_FIRST_AUDIO as string),
			),
	)
	const playback = spanByName(spans, SPAN_NAMES.PLAYBACK)
	check(
		"playback span: status + local",
		playback?.attributes[ATTR.PLAYBACK_STATUS] === "completed" &&
			playback.attributes[ATTR.PLAYBACK_LOCAL] === true,
	)
	check(
		"all spans end at or after they start",
		spans.every((s) => s.duration[0] >= 0 && s.duration[1] >= 0),
	)

	exporter.reset()
	const failedId = randomUUID()
	emitTurnEvent({
		interactionId: failedId,
		originDomiaKey,
		type: DOMIA_TURN_EVENT_ENUM.TURN_STARTED,
		inputType: "text",
		source: "console",
	})
	emitTurnEvent({
		interactionId: failedId,
		originDomiaKey,
		type: DOMIA_TURN_EVENT_ENUM.TURN_FAILED,
		step: "llm",
		errorCode: "LLM/TIMEOUT",
		errorMessage: "llm timed out",
	})
	await flush()
	const failedRoot = spanByName(exporter.getFinishedSpans(), SPAN_NAMES.TURN)
	check(
		"failed turn → root span status ERROR with step + code",
		failedRoot?.status.code === SpanStatusCode.ERROR &&
			failedRoot.attributes[ATTR.TURN_FAILED_STEP] === "llm" &&
			failedRoot.attributes[ATTR.TURN_ERROR_CODE] === "LLM/TIMEOUT",
		JSON.stringify(failedRoot?.status),
	)
	check(
		"turn without domia traceId still gets a random otel trace id",
		/^[0-9a-f]{32}$/.test(failedRoot?.spanContext().traceId ?? ""),
	)

	bridge.stop()
	exporter.reset()
	emitTurnEvent({
		interactionId: randomUUID(),
		originDomiaKey,
		type: DOMIA_TURN_EVENT_ENUM.TURN_ABORTED,
		reason: "after stop",
	})
	await flush()
	check(
		"stopped bridge emits nothing",
		exporter.getFinishedSpans().length === 0,
	)
	await provider.shutdown()
}

const traceIdChecks = (): void => {
	console.log("\n== trace id derivation ==")
	check(
		"uuid → 32 hex",
		otelTraceIdFromDomia("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0") ===
			"0f1e2d3c4b5a69788796a5b4c3d2e1f0",
	)
	check(
		"arbitrary header → stable 32 hex",
		otelTraceIdFromDomia("req-42") === otelTraceIdFromDomia("req-42") &&
			/^[0-9a-f]{32}$/.test(otelTraceIdFromDomia("req-42") ?? ""),
	)
	check("undefined → null", otelTraceIdFromDomia(undefined) === null)
}

const main = async (): Promise<void> => {
	console.log("=== otel (H3 tracing bridge) ===")
	const loadedBeforeAnything = sdkLoaded()
	check(
		"sdk-trace-base is loaded here only because this eval imports it",
		loadedBeforeAnything,
	)
	await offChecks()
	traceIdChecks()
	await syntheticTurn()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()

import { randomUUID } from "crypto"

import {
	adaptiveVadWindow,
	createVadWindow,
	observeIntraTurnPause,
	resetDynamicEndpointing,
	resolveDebounceMs,
	type SpeculativeCaptureHooksType,
	type SpeculativeCaptureResultType,
	type VadWindowType,
} from "@/modules/audio-capture"
import { runSpeculativeTurn } from "@/modules/core-bus/controller/speculative-turn"
import { startSatelliteSpeculation } from "@/modules/satellite-core/controller/speculation"
import {
	subscribeToDomiaBus,
	unsubscribeFromDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
} from "@/buses"
import type { SttDonePayloadType } from "@/modules/core-bus"
import type { SttStreamSessionType } from "@/modules/stt-engine"
import type { CoreBusFeaturesType } from "@/modules/core-bus"
import type { SttEngineAdapterType } from "@/modules/stt-engine"
import {
	STT_ENGINE_ENUM,
	RESPONSE_TYPE_ENUM,
	type SelectWakeWordConfigType,
} from "@/db"
import { baseWakeWordConfig, getDomia } from "@/test-utils"

import { fabricateSegmentPcm, feedVadTimeline, makeChecker, sleep } from "./lib"
import type { FakeAudioScriptType, VadTickSampleType } from "./types"

const checker = makeChecker()

const ENDPOINT_COMPLETE_MS = 240
const ENDPOINT_INCOMPLETE_MS = 1100
const ENDPOINT_WAIT_MS = 1600
const SETTLE_MS = 40

const dynConfig = (
	overrides: Partial<SelectWakeWordConfigType> = {},
): SelectWakeWordConfigType => ({
	...baseWakeWordConfig(),
	dynamicEndpointingEnabled: true,
	dynamicEndpointMinMs: 300,
	dynamicEndpointMaxMs: 1500,
	dynamicEndpointAlpha: 0.9,
	dynamicEndpointMargin: 1.5,
	vadMinSilenceS: 0.5,
	vadEndOfSpeechMs: 700,
	vadThreshold: 0.35,
	numThreads: 1,
	provider: "cpu",
	sampleRate: 16000,
	...overrides,
})

const runFabricatorChecks = (): void => {
	console.log("\nfake-audio fabricator")
	const a = fabricateSegmentPcm("speech", 100)
	const b = fabricateSegmentPcm("speech", 100)
	checker.check("speech PCM is deterministic", a.equals(b))
	checker.check(
		"speech PCM has expected byte length",
		a.length === 3200,
		`got=${a.length}`,
	)
	const peaks = Array.from({ length: a.length / 2 }, (_, i) =>
		Math.abs(a.readInt16LE(i * 2)),
	)
	checker.check(
		"speech PCM is loud",
		Math.max(...peaks) > 8000,
		`peak=${Math.max(...peaks)}`,
	)
	const silence = fabricateSegmentPcm("silence", 100)
	checker.check(
		"silence PCM is all zeros",
		silence.length === 3200 && silence.every((byte) => byte === 0),
		`len=${silence.length}`,
	)
}

const runDynamicEndpointingChecks = (): void => {
	console.log("\ndynamic endpointing (EMA debounce)")
	const config = dynConfig()
	const baseMs = config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs
	const id = "turn-logic-dyn"

	resetDynamicEndpointing(id)
	checker.check(
		"no observations → base debounce",
		resolveDebounceMs(id, config) === baseMs,
		`got=${resolveDebounceMs(id, config)}`,
	)

	const disabled = dynConfig({ dynamicEndpointingEnabled: false })
	observeIntraTurnPause(id, 400, disabled)
	checker.check(
		"disabled flag → base debounce and no state",
		resolveDebounceMs(id, disabled) === baseMs &&
			resolveDebounceMs(id, config) === baseMs,
		`got=${resolveDebounceMs(id, disabled)}`,
	)

	resetDynamicEndpointing(id)
	observeIntraTurnPause(id, 400, config)
	checker.check(
		"single observation seeds EMA (400ms × 1.5 → 600ms)",
		resolveDebounceMs(id, config) === 600,
		`got=${resolveDebounceMs(id, config)}`,
	)

	resetDynamicEndpointing(id)
	observeIntraTurnPause(id, 1000, config)
	const seededHigh = resolveDebounceMs(id, config)
	for (let i = 0; i < 60; i++) observeIntraTurnPause(id, 400, config)
	const converged = resolveDebounceMs(id, config)
	checker.check(
		"EMA converges toward observed pause × margin",
		seededHigh === config.dynamicEndpointMaxMs &&
			Math.abs(converged - 600) <= 5,
		`seeded=${seededHigh} converged=${converged}`,
	)

	resetDynamicEndpointing(id)
	observeIntraTurnPause(id, 100, config)
	checker.check(
		"clamped by dynamicEndpointMinMs",
		resolveDebounceMs(id, config) === config.dynamicEndpointMinMs,
		`got=${resolveDebounceMs(id, config)}`,
	)

	resetDynamicEndpointing(id)
	observeIntraTurnPause(id, 1400, config)
	checker.check(
		"clamped by dynamicEndpointMaxMs",
		resolveDebounceMs(id, config) === config.dynamicEndpointMaxMs,
		`got=${resolveDebounceMs(id, config)}`,
	)

	resetDynamicEndpointing(id)
	observeIntraTurnPause(id, 0, config)
	observeIntraTurnPause(id, -50, config)
	observeIntraTurnPause(id, config.dynamicEndpointMaxMs * 2 + 1, config)
	checker.check(
		"out-of-range pauses ignored",
		resolveDebounceMs(id, config) === baseMs,
		`got=${resolveDebounceMs(id, config)}`,
	)

	observeIntraTurnPause(id, 400, config)
	resetDynamicEndpointing(id)
	checker.check(
		"reset clears state → base debounce",
		resolveDebounceMs(id, config) === baseMs,
		`got=${resolveDebounceMs(id, config)}`,
	)
}

const sampleVadTimeline = async (
	vad: VadWindowType,
	script: FakeAudioScriptType,
): Promise<VadTickSampleType[]> => {
	const samples: VadTickSampleType[] = []
	await feedVadTimeline(vad, script, (tick) => {
		samples.push({
			...tick,
			speechActive: vad.speechActive(),
			everDetected: vad.everDetected(),
			completed: vad.completed(),
		})
	})
	return samples
}

const runVadWindowChecks = async (): Promise<void> => {
	console.log("\ncreateVadWindow with fabricated PCM (real silero)")
	const config = dynConfig({
		dynamicEndpointingEnabled: false,
		vadMinSilenceS: 0.3,
		vadEndOfSpeechMs: 300,
	})
	const vad = createVadWindow(config)
	const speechEndMs = 1200
	const samples = await sampleVadTimeline(vad, {
		segments: [
			{ kind: "silence", ms: 300 },
			{ kind: "speech", ms: 900 },
			{ kind: "silence", ms: 1500 },
		],
	})
	const lead = samples.filter((s) => s.elapsedMs <= 300)
	checker.check(
		"no detection during leading silence",
		lead.every((s) => !s.everDetected && !s.speechActive && !s.completed),
	)
	checker.check(
		"speechActive during speech segment",
		samples.some((s) => s.kind === "speech" && s.speechActive),
	)
	const last = samples[samples.length - 1]
	checker.check("everDetected latches after speech", last.everDetected)
	checker.check("speechActive drops back after speech", !last.speechActive)
	const firstCompleted = samples.find((s) => s.completed)
	checker.check(
		"completed() fires after configured silence only",
		firstCompleted !== undefined &&
			firstCompleted.elapsedMs >= speechEndMs + config.vadEndOfSpeechMs,
		`firstCompletedAt=${firstCompleted?.elapsedMs}`,
	)
	checker.check("completed() true by end of timeline", last.completed)
}

const runAdaptiveWindowChecks = async (): Promise<void> => {
	console.log("\nadaptiveVadWindow debounce split (real silero)")
	const config = dynConfig()
	const baseMs = config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs

	const freshId = "turn-logic-adaptive-fresh"
	resetDynamicEndpointing(freshId)
	const fresh = adaptiveVadWindow(freshId, config)
	checker.check(
		"no data → debounce equals base",
		fresh.debounceMs === baseMs,
		`got=${fresh.debounceMs}`,
	)

	const seededId = "turn-logic-adaptive-seeded"
	resetDynamicEndpointing(seededId)
	observeIntraTurnPause(seededId, 400, config)
	const seeded = adaptiveVadWindow(seededId, config)
	checker.check(
		"seeded EMA 400ms → debounce 600ms",
		seeded.debounceMs === 600,
		`got=${seeded.debounceMs}`,
	)

	const both: VadWindowType = {
		feed: (data) => {
			seeded.vad.feed(data)
			fresh.vad.feed(data)
		},
		completed: () => seeded.vad.completed(),
		speechActive: () => seeded.vad.speechActive(),
		silenceMs: () => seeded.vad.silenceMs(),
		holdMs: () => seeded.vad.holdMs(),
		everDetected: () => seeded.vad.everDetected(),
	}
	const speechEndMs = 1140
	let seededCompletedAt = 0
	let freshCompletedAt = 0
	await feedVadTimeline(
		both,
		{
			segments: [
				{ kind: "silence", ms: 240 },
				{ kind: "speech", ms: 900 },
				{ kind: "silence", ms: 1800 },
			],
		},
		(tick) => {
			if (seededCompletedAt === 0 && seeded.vad.completed())
				seededCompletedAt = tick.elapsedMs
			if (freshCompletedAt === 0 && fresh.vad.completed())
				freshCompletedAt = tick.elapsedMs
		},
	)
	checker.check(
		"adapted window completes near its 600ms debounce",
		seededCompletedAt > speechEndMs + 250 &&
			seededCompletedAt < speechEndMs + 1050,
		`completedAt=+${seededCompletedAt - speechEndMs}ms`,
	)
	checker.check(
		"base window completes near its 1200ms debounce",
		freshCompletedAt > speechEndMs + 800,
		`completedAt=+${freshCompletedAt - speechEndMs}ms`,
	)
	checker.check(
		"split preserves ordering: adapted completes well before base",
		seededCompletedAt > 0 &&
			freshCompletedAt > 0 &&
			seededCompletedAt + 300 <= freshCompletedAt,
		`adapted=${seededCompletedAt} base=${freshCompletedAt}`,
	)
}

const makeSpecHarness = (scriptedTranscripts: string[]) => {
	const domia = getDomia({
		wakeWordConfigOverrides: {
			semanticEndpointingEnabled: true,
			endpointCompleteMs: ENDPOINT_COMPLETE_MS,
			endpointIncompleteMs: ENDPOINT_INCOMPLETE_MS,
			endpointWaitMs: ENDPOINT_WAIT_MS,
			speculativeTtsEnabled: false,
		},
		moduleSettingsOverrides: {
			memoryEngine: false,
			emotionEngine: false,
			factRecall: false,
			skillsEngine: false,
		},
	})
	let sttCalls = 0
	const debounceCalls: number[] = []
	const adapter: SttEngineAdapterType = {
		id: STT_ENGINE_ENUM.PARAKEET,
		capabilities: { streaming: false, expectedSampleRate: 16000 },
		run: () => Promise.resolve(""),
		runPcm: () => {
			sttCalls += 1
			return Promise.resolve(
				scriptedTranscripts[sttCalls - 1] ?? "final decode words",
			)
		},
	}
	const features: CoreBusFeaturesType = {
		capabilities: {
			wakeword: true,
			record: true,
			stt: true,
			intentDetection: false,
			intentExecution: false,
			promptGeneration: true,
			llm: true,
			tts: false,
			playback: false,
		},
		stt: { adapter, canStream: false },
		tts: null,
		llm: null,
		canRunStt: true,
		canRunLlm: true,
		canRunTts: false,
		canPlayback: false,
		canStreamStt: false,
		canStreamLlm: false,
		canStreamTts: false,
		canSentencePipeline: false,
	}
	let resolveFinalPcm: (pcm: Buffer) => void = () => undefined
	const finalPcmPromise = new Promise<Buffer>((resolve) => {
		resolveFinalPcm = resolve
	})
	let hooks: SpeculativeCaptureHooksType | undefined
	const capture: SpeculativeCaptureResultType = {
		debounceMs: 600,
		finalPcmPromise,
		filePathPromise: new Promise<string>(() => undefined),
		speechEndAt: () => null,
		endpointObservedMs: () => null,
		stop: () => undefined,
		setDebounceMs: (ms) => {
			debounceCalls.push(ms)
		},
	}
	const runPromise = runSpeculativeTurn(
		{ domia, features },
		{
			interactionId: randomUUID(),
			release: () => undefined,
			captureFactory: (h) => {
				hooks = h
				return capture
			},
		},
	)
	return {
		debounceCalls,
		sttCallCount: () => sttCalls,
		speculate: () => hooks?.onSpeculate(fabricateSegmentPcm("speech", 200)),
		finish: async () => {
			resolveFinalPcm(fabricateSegmentPcm("speech", 200))
			await runPromise
		},
	}
}

const runSpeculationChecks = async (): Promise<void> => {
	console.log(
		"\nspeculation guards (real runSpeculativeTurn via captureFactory)",
	)
	console.log("  ~ endpointHintMs covered via onPartial → setDebounceMs seam")
	console.log(
		"  ~ SPECULATION_MAX_* constants module-private: asserted behaviorally",
	)

	const a = makeSpecHarness([
		"turn off the lights.",
		"turn off the",
		"tell me about bananas",
	])
	await sleep(SETTLE_MS)
	a.speculate()
	await sleep(SETTLE_MS)
	checker.check(
		"speculation g1 decodes partial transcript",
		a.sttCallCount() === 1,
		`calls=${a.sttCallCount()}`,
	)
	checker.check(
		"semantic hint: complete tail → endpointCompleteMs",
		a.debounceCalls.length === 1 && a.debounceCalls[0] === ENDPOINT_COMPLETE_MS,
		`calls=${JSON.stringify(a.debounceCalls)}`,
	)
	a.speculate()
	await sleep(SETTLE_MS)
	checker.check(
		"semantic hint: incomplete tail → endpointIncompleteMs",
		a.debounceCalls.length === 2 &&
			a.debounceCalls[1] === ENDPOINT_INCOMPLETE_MS,
		`calls=${JSON.stringify(a.debounceCalls)}`,
	)
	a.speculate()
	await sleep(SETTLE_MS)
	checker.check(
		"semantic hint: neutral tail → endpointCompleteMs (streaming STT emits no terminal punctuation)",
		a.debounceCalls.length === 3 && a.debounceCalls[2] === ENDPOINT_COMPLETE_MS,
		`calls=${JSON.stringify(a.debounceCalls)}`,
	)
	checker.check(
		"speculation g3 still within retry budget",
		a.sttCallCount() === 3,
		`calls=${a.sttCallCount()}`,
	)
	a.speculate()
	a.speculate()
	await sleep(SETTLE_MS)
	checker.check(
		"retry budget: attempts beyond 3 are ignored",
		a.sttCallCount() === 3,
		`calls=${a.sttCallCount()}`,
	)
	await a.finish()
	checker.check(
		"final decode fallback still runs after budget exhaustion",
		a.sttCallCount() === 4,
		`calls=${a.sttCallCount()}`,
	)

	const f = makeSpecHarness(["turn off the lights um"])
	await sleep(SETTLE_MS)
	f.speculate()
	await sleep(SETTLE_MS)
	checker.check(
		"semantic hint: filler tail → endpointWaitMs (wait-state)",
		f.debounceCalls.length === 1 && f.debounceCalls[0] === ENDPOINT_WAIT_MS,
		`calls=${JSON.stringify(f.debounceCalls)}`,
	)
	await f.finish()

	const b = makeSpecHarness([])
	await sleep(SETTLE_MS)
	const realNow = Date.now
	Date.now = () => realNow() + 11000
	try {
		b.speculate()
	} finally {
		Date.now = realNow
	}
	await sleep(SETTLE_MS)
	checker.check(
		"max-utterance guard: no speculation past 10s of turn",
		b.sttCallCount() === 0,
		`calls=${b.sttCallCount()}`,
	)
	await b.finish()
	checker.check(
		"max-utterance guard: final decode still runs",
		b.sttCallCount() === 1,
		`calls=${b.sttCallCount()}`,
	)
}

const makeFakeStreamSession = (script: {
	partial: () => string
	final: () => string
}) => {
	let flushPartialCalls = 0
	let finishCalls = 0
	let partialCalls = 0
	const session: SttStreamSessionType = {
		pushChunk: () => undefined,
		partial: () => {
			partialCalls += 1
			return script.partial()
		},
		flushPartial: () => {
			flushPartialCalls += 1
			return Promise.resolve(script.partial())
		},
		finish: () => {
			finishCalls += 1
			return Promise.resolve(script.final())
		},
		reset: () => undefined,
		abort: () => undefined,
	}
	return {
		session,
		flushPartialCalls: () => flushPartialCalls,
		finishCalls: () => finishCalls,
		partialCalls: () => partialCalls,
	}
}

const satSpecDomia = () =>
	getDomia({
		wakeWordConfigOverrides: {
			satelliteSpeculationEnabled: true,
			speculativeSilenceMs: 300,
			speculativeTtsEnabled: false,
			vadMinSilenceS: 0.5,
			vadEndOfSpeechMs: 250,
			vadThreshold: 0.35,
			numThreads: 1,
			provider: "cpu",
			sampleRate: 16000,
		},
		runtimeCapabilitiesOverrides: { llm: false },
		moduleSettingsOverrides: {
			memoryEngine: false,
			emotionEngine: false,
			factRecall: false,
			skillsEngine: false,
		},
	})

const feedSilenceUntilSpeculated = async (
	feed: (pcm: Buffer) => void,
	isSpeculated: () => boolean,
): Promise<boolean> => {
	for (let i = 0; i < 20 && !isSpeculated(); i++) {
		feed(fabricateSegmentPcm("silence", 100))
		await sleep(100)
	}
	return isSpeculated()
}

const runSatelliteSpeculationChecks = async (): Promise<void> => {
	console.log(
		"\nsatellite speculation (startSatelliteSpeculation, real silero + fake stt session)",
	)
	const domia = satSpecDomia()
	const speech = fabricateSegmentPcm("speech", 700)

	const offDomia = getDomia({
		wakeWordConfigOverrides: { satelliteSpeculationEnabled: false },
	})
	const fakeOff = makeFakeStreamSession({
		partial: () => "x",
		final: () => "x",
	})
	const offSpec = await startSatelliteSpeculation({
		identity: offDomia,
		interactionId: randomUUID(),
		sttSession: () => fakeOff.session,
		vadDebounceMs: 750,
		bufferedPcm: () => speech,
	})
	checker.check("flag off → speculation not armed", offSpec === null)

	const noSession = await startSatelliteSpeculation({
		identity: domia,
		interactionId: randomUUID(),
		sttSession: () => null,
		vadDebounceMs: 750,
		bufferedPcm: () => speech,
	})
	checker.check(
		"no live stt session → speculation not armed",
		noSession === null,
	)

	const fake = makeFakeStreamSession({
		partial: () => "turn off the lamp",
		final: () => "turn off the lamp",
	})
	const iid = randomUUID()
	const published: SttDonePayloadType[] = []
	const capture = (payload: SttDonePayloadType): void => {
		published.push(payload)
	}
	subscribeToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, capture)
	const spec = await startSatelliteSpeculation({
		identity: domia,
		interactionId: iid,
		sttSession: () => fake.session,
		vadDebounceMs: 750,
		bufferedPcm: () => speech,
	})
	checker.check("speculation armed with live session", spec !== null)
	if (!spec) {
		unsubscribeFromDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, capture)
		return
	}
	await sleep(SETTLE_MS)
	let speculatedSeen = false
	const fired = await feedSilenceUntilSpeculated(
		(pcm) => {
			spec.feed(pcm, () => speech)
			if (fake.partialCalls() > 0 || published.length > 0) speculatedSeen = true
		},
		() => speculatedSeen || fake.partialCalls() > 0,
	)
	checker.check(
		"fast-VAD silence fires onSpeculate (partial snapshot, no pad flush)",
		fired && fake.partialCalls() >= 1 && fake.flushPartialCalls() === 0,
		`partialCalls=${fake.partialCalls()} flushPartialCalls=${fake.flushPartialCalls()}`,
	)
	await sleep(SETTLE_MS)
	checker.check("no publish before handoff", published.length === 0)
	spec.handoff({
		pcm: speech,
		speechEndAt: Date.now(),
		filePathPromise: Promise.resolve("/tmp/turn-logic-sat.wav"),
	})
	await spec.done
	await sleep(SETTLE_MS)
	checker.check(
		"handoff → exactly one STT_DONE publish",
		published.length === 1,
		`published=${published.length}`,
	)
	const payload = published[0]
	checker.check(
		"published transcript comes from session.finish()",
		payload?.transcript === "turn off the lamp" && fake.finishCalls() === 1,
		`transcript="${payload?.transcript}" finishCalls=${fake.finishCalls()}`,
	)
	checker.check(
		"satellite publish shape: liveVoice false + responseType VOICE",
		payload?.liveVoice === false &&
			payload?.responseType === RESPONSE_TYPE_ENUM.VOICE,
		`liveVoice=${String(payload?.liveVoice)} responseType=${String(payload?.responseType)}`,
	)
	checker.check(
		"speech-end anchoring travels in the payload",
		typeof payload?.speechEndAt === "number",
	)
	payload?.prestartedRelease?.()
	unsubscribeFromDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, capture)

	const fake2 = makeFakeStreamSession({
		partial: () => "never mind",
		final: () => "never mind",
	})
	const iid2 = randomUUID()
	const published2: SttDonePayloadType[] = []
	const capture2 = (payload2: SttDonePayloadType): void => {
		published2.push(payload2)
	}
	subscribeToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, capture2)
	const spec2 = await startSatelliteSpeculation({
		identity: domia,
		interactionId: iid2,
		sttSession: () => fake2.session,
		vadDebounceMs: 750,
		bufferedPcm: () => speech,
	})
	checker.check("second speculation armed (slot was released)", spec2 !== null)
	if (spec2) {
		await sleep(SETTLE_MS)
		await feedSilenceUntilSpeculated(
			(pcm) => spec2.feed(pcm, () => speech),
			() => fake2.partialCalls() > 0,
		)
		const afterG1 = fake2.partialCalls()
		for (let i = 0; i < 6; i++) {
			spec2.feed(fabricateSegmentPcm("speech", 100), () => speech)
			await sleep(100)
		}
		await feedSilenceUntilSpeculated(
			(pcm) => spec2.feed(pcm, () => speech),
			() => fake2.partialCalls() > afterG1,
		)
		checker.check(
			"speech resume → onResume → second speculation generation",
			fake2.partialCalls() > afterG1,
			`partialCalls=${fake2.partialCalls()} afterG1=${afterG1}`,
		)
		spec2.abort("turn-logic cancel")
		await spec2.done
		await sleep(SETTLE_MS)
		checker.check(
			"abort → tail exits with zero publishes",
			published2.length === 0,
			`published=${published2.length}`,
		)
		checker.check(
			"abort → finish() never called on the shared session",
			fake2.finishCalls() === 0,
			`finishCalls=${fake2.finishCalls()}`,
		)
	}
	unsubscribeFromDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, capture2)
}

const main = async (): Promise<void> => {
	runFabricatorChecks()
	runDynamicEndpointingChecks()
	await runSpeculationChecks()
	await runSatelliteSpeculationChecks()
	await runVadWindowChecks()
	await runAdaptiveWindowChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} turn-logic checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()

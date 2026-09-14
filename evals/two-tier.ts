import { randomUUID } from "crypto"

import {
	createTwoTierTracker,
	twoTierConfigFromWakeWord,
	twoTierEndpointArmed,
	eagerPrefillRelation,
	settleEagerPrefill,
} from "@/modules/core-bus/utils"
import { runSpeculativeTurn } from "@/modules/core-bus/controller/speculative-turn"
import { startSatelliteSpeculation } from "@/modules/satellite-core/controller/speculation"
import { activeVoiceReplies } from "@/modules/voice-admission"
import {
	subscribeToDomiaBus,
	unsubscribeFromDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	type EagerPrefillHandleType,
} from "@/buses"
import type {
	SttDonePayloadType,
	CoreBusFeaturesType,
	TwoTierEndpointConfigType,
	TwoTierWindowType,
} from "@/modules/core-bus"
import type {
	SpeculativeCaptureHooksType,
	SpeculativeCaptureResultType,
} from "@/modules/audio-capture"
import type {
	SttEngineAdapterType,
	SttStreamSessionType,
} from "@/modules/stt-engine"
import type {
	LlmEngineAdapterType,
	LlmPrefillResultType,
} from "@/modules/llm-engine"
import {
	STT_ENGINE_ENUM,
	LLM_ENGINE_ENUM,
	DEFAULT_TWO_TIER_ENDPOINT_ENABLED,
	DEFAULT_TWO_TIER_EAGER_MIN_PARTIAL_CHARS,
	DEFAULT_TWO_TIER_PREFILL_IDLE_GUARD_MS,
	DEFAULT_TWO_TIER_RESUME_GRACE_MS,
	DEFAULT_TWO_TIER_MAX_EAGER_PREFILLS,
	DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
	type SelectWakeWordConfigType,
	type SelectLlmModelConfigType,
} from "@/db"
import { baseWakeWordConfig, getDomia } from "@/test-utils"

import { fabricateSegmentPcm, makeChecker, sleep } from "./lib"

const checker = makeChecker()
const SETTLE_MS = 60

const cfg = (
	overrides: Partial<TwoTierEndpointConfigType> = {},
): TwoTierEndpointConfigType => ({
	enabled: true,
	eagerMinPartialChars: 8,
	prefillIdleGuardMs: 150,
	resumeGraceMs: 300,
	maxEagerPrefills: 3,
	settleMaxWaitMs: DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
	...overrides,
})

const win = (debounceMs = 700, eagerSilenceMs = 300): TwoTierWindowType => ({
	debounceMs: () => debounceMs,
	eagerSilenceMs,
})

const idle = { slotBusy: false }

const runTrackerChecks = (): void => {
	console.log("\ntwo-tier tracker (pure state machine)")

	const off = createTwoTierTracker(cfg({ enabled: false }), win())
	const offEager = off.onEager("turn off the lights", idle)
	const offResume = off.onResume()
	const offFinal = off.onFinal("turn off the lights")
	checker.check(
		"off → eager/resume/final are all no-ops (identical to today)",
		offEager.action === "skip" &&
			offEager.reason === "disabled" &&
			offResume.action === "none" &&
			offFinal.action === "decode" &&
			off.stats().prefills === 0,
		JSON.stringify([offEager, offResume, offFinal]),
	)

	const reuseEq = createTwoTierTracker(cfg(), win())
	const e1 = reuseEq.onEager("turn off the lights", idle)
	const f1 = reuseEq.onFinal("Turn off the lights.")
	checker.check(
		"eager → final (equal modulo case/punctuation) → reuse",
		e1.action === "prefill" &&
			e1.generation === 1 &&
			f1.action === "reuse" &&
			f1.relation === "equal" &&
			reuseEq.state() === "final" &&
			reuseEq.stats().reused === 1,
		JSON.stringify([e1, f1]),
	)

	const reuseExt = createTwoTierTracker(cfg(), win())
	reuseExt.onEager("turn off the", idle)
	const f2 = reuseExt.onFinal("turn off the lights in the office")
	checker.check(
		"eager → final extends the partial → reuse (prefix KV stays valid)",
		f2.action === "reuse" && f2.relation === "extends",
		JSON.stringify(f2),
	)

	const diverge = createTwoTierTracker(cfg(), win())
	diverge.onEager("turn on the lights", idle)
	const f3 = diverge.onFinal("play some music")
	checker.check(
		"eager → final diverges → reprefill (fresh prefill on decode)",
		f3.action === "reprefill" && diverge.stats().reprefilled === 1,
		JSON.stringify(f3),
	)

	const cancel = createTwoTierTracker(cfg({ resumeGraceMs: 0 }), win())
	const c1 = cancel.onEager("turn off the lights", idle)
	const r1 = cancel.onResume()
	const f4 = cancel.onFinal("turn off the lights and the fan")
	checker.check(
		"eager → resume → in-flight prefill cancelled → final decodes fresh",
		c1.action === "prefill" &&
			r1.action === "cancel" &&
			r1.generation === 1 &&
			f4.action === "decode" &&
			cancel.stats().cancelled === 1,
		JSON.stringify([c1, r1, f4]),
	)

	const settledThenResume = createTwoTierTracker(cfg(), win())
	settledThenResume.onEager("turn off the", idle)
	settledThenResume.onSettled(1)
	const r2 = settledThenResume.onResume()
	const f5 = settledThenResume.onFinal("turn off the lights")
	checker.check(
		"resume after a settled prefill → nothing to cancel, prefix still reused",
		r2.action === "none" && f5.action === "reuse" && f5.relation === "extends",
		JSON.stringify([r2, f5]),
	)

	const same = createTwoTierTracker(cfg({ resumeGraceMs: 0 }), win())
	same.onEager("turn off the lights", idle)
	same.onSettled(1)
	same.onResume()
	const s2 = same.onEager("turn off the lights.", idle)
	checker.check(
		"same partial after a settled prefill → skip (KV already hot)",
		s2.action === "skip" && s2.reason === "same-partial",
		JSON.stringify(s2),
	)

	const noEager = createTwoTierTracker(cfg(), win())
	const f6 = noEager.onFinal("hello there")
	const late = noEager.onEager("hello there", idle)
	checker.check(
		"final without eager → decode; eager after final → skip finalized",
		f6.action === "decode" &&
			late.action === "skip" &&
			late.reason === "finalized",
		JSON.stringify([f6, late]),
	)

	const max = createTwoTierTracker(cfg({ resumeGraceMs: 0 }), win())
	const outcomes: string[] = []
	for (let i = 1; i <= 4; i++) {
		const d = max.onEager(`partial number ${i} of the utterance`, idle)
		outcomes.push(d.action === "prefill" ? `p${d.generation}` : d.reason)
		max.onResume()
	}
	checker.check(
		"max eager prefills per turn is enforced",
		outcomes.join(",") === "p1,p2,p3,max-prefills" &&
			max.stats().prefills === 3,
		outcomes.join(","),
	)

	const short = createTwoTierTracker(cfg(), win())
	const sh = short.onEager("hi", idle)
	checker.check(
		"partial shorter than eagerMinPartialChars → skip",
		sh.action === "skip" && sh.reason === "short-partial",
		JSON.stringify(sh),
	)

	const guard = createTwoTierTracker(cfg(), win(400, 300))
	const g = guard.onEager("turn off the lights", idle)
	checker.check(
		"idle guard: debounce − eager silence < guard → skip",
		g.action === "skip" && g.reason === "idle-guard",
		JSON.stringify(g),
	)

	const grace = createTwoTierTracker(cfg({ resumeGraceMs: 300 }), win())
	grace.onEager("turn off the lights", { slotBusy: false, now: 1000 })
	grace.onResume(2000)
	const tooSoon = grace.onEager("turn off the lights now", {
		slotBusy: false,
		now: 2100,
	})
	const later = grace.onEager("turn off the lights now", {
		slotBusy: false,
		now: 2400,
	})
	checker.check(
		"resume grace: eager within grace → skip, after grace → prefill",
		tooSoon.action === "skip" &&
			tooSoon.reason === "resume-grace" &&
			later.action === "prefill" &&
			later.generation === 2,
		JSON.stringify([tooSoon, later]),
	)

	const busy = createTwoTierTracker(cfg(), win())
	const b = busy.onEager("turn off the lights", { slotBusy: true })
	checker.check(
		"identity slot busy → skip (never queues behind another turn)",
		b.action === "skip" && b.reason === "slot-busy",
		JSON.stringify(b),
	)

	checker.check(
		"relation: partial-word prefix counts as extends",
		eagerPrefillRelation("turn off the li", "Turn off the lights") ===
			"extends" &&
			eagerPrefillRelation("", "anything") === "diverges" &&
			eagerPrefillRelation("what time is it", "What time is it?") === "equal",
	)

	const defaults = twoTierConfigFromWakeWord(baseWakeWordConfig())
	checker.check(
		"schema defaults: OFF, chars/guard/grace/max/settle-wait carried from constants",
		defaults.enabled === DEFAULT_TWO_TIER_ENDPOINT_ENABLED &&
			defaults.eagerMinPartialChars ===
				DEFAULT_TWO_TIER_EAGER_MIN_PARTIAL_CHARS &&
			defaults.prefillIdleGuardMs === DEFAULT_TWO_TIER_PREFILL_IDLE_GUARD_MS &&
			defaults.resumeGraceMs === DEFAULT_TWO_TIER_RESUME_GRACE_MS &&
			defaults.maxEagerPrefills === DEFAULT_TWO_TIER_MAX_EAGER_PREFILLS &&
			defaults.settleMaxWaitMs === DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
		JSON.stringify(defaults),
	)
}

const emptyPrefill: LlmPrefillResultType = {
	promptTokens: null,
	freshTokens: null,
	cachedTokens: null,
	prefillMs: null,
}

const makeLlm = (holdMs: number) => {
	const calls: { prompt: string; signal: AbortSignal | undefined }[] = []
	let streams = 0
	const adapter: LlmEngineAdapterType = {
		id: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
		capabilities: { streaming: true },
		run: () => Promise.resolve(""),
		runStream: async function* () {
			streams += 1
			await sleep(1)
			yield "Okay."
		},
		prefill: (_domia, prompt, signal) =>
			new Promise<LlmPrefillResultType>((resolve) => {
				calls.push({ prompt, signal })
				const timer = setTimeout(
					() =>
						resolve({
							promptTokens: 40,
							freshTokens: 12,
							cachedTokens: 28,
							prefillMs: holdMs,
						}),
					holdMs,
				)
				signal?.addEventListener("abort", () => {
					clearTimeout(timer)
					resolve(emptyPrefill)
				})
			}),
	}
	return { adapter, calls, streams: () => streams }
}

const makeSession = (partial: () => string, final: () => string) => {
	let finishCalls = 0
	const session: SttStreamSessionType = {
		pushChunk: () => undefined,
		partial,
		flushPartial: () => Promise.resolve(partial()),
		finish: () => {
			finishCalls += 1
			return Promise.resolve(final())
		},
		reset: () => undefined,
		abort: () => undefined,
	}
	return { session, finishCalls: () => finishCalls }
}

type HarnessOptsType = {
	wakeWord?: Partial<SelectWakeWordConfigType>
	llm?: Partial<SelectLlmModelConfigType>
	holdMs?: number
	decodeSpeculation?: boolean
	release?: () => void
	partial: () => string
	final: () => string
}

const makeHarness = (opts: HarnessOptsType) => {
	const domia = getDomia({
		wakeWordConfigOverrides: {
			twoTierEndpointEnabled: true,
			speculativeSilenceMs: 300,
			twoTierEagerMinPartialChars: 4,
			twoTierPrefillIdleGuardMs: 0,
			twoTierResumeGraceMs: 0,
			twoTierMaxEagerPrefills: 3,
			semanticEndpointingEnabled: false,
			speculativeTtsEnabled: false,
			...opts.wakeWord,
		},
		llmModelConfigOverrides: {
			engine: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
			slotAffinityEnabled: false,
			...opts.llm,
		},
		moduleSettingsOverrides: {
			memoryEngine: false,
			emotionEngine: false,
			factRecall: false,
			skillsEngine: false,
		},
	})
	const llm = makeLlm(opts.holdMs ?? 30)
	const stt = makeSession(opts.partial, opts.final)
	const adapter: SttEngineAdapterType = {
		id: STT_ENGINE_ENUM.NEMO_SPEECH,
		capabilities: {
			streaming: true,
			expectedSampleRate: 16000,
			external: true,
		},
		run: () => Promise.resolve(""),
		runPcm: () => Promise.resolve(opts.final()),
		createSession: () => stt.session,
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
		stt: { adapter, canStream: true },
		tts: null,
		llm: { adapter: llm.adapter, canStream: true },
		canRunStt: true,
		canRunLlm: true,
		canRunTts: false,
		canPlayback: false,
		canStreamStt: true,
		canStreamLlm: true,
		canStreamTts: false,
		canSentencePipeline: false,
	}
	let resolveFinalPcm: (pcm: Buffer) => void = () => undefined
	const finalPcmPromise = new Promise<Buffer>((resolve) => {
		resolveFinalPcm = resolve
	})
	let hooks: SpeculativeCaptureHooksType | undefined
	const capture: SpeculativeCaptureResultType = {
		debounceMs: 700,
		finalPcmPromise,
		filePathPromise: new Promise<string>(() => undefined),
		speechEndAt: () => Date.now(),
		endpointObservedMs: () => 700,
		stop: () => undefined,
	}
	const published: SttDonePayloadType[] = []
	const onPublish = (payload: SttDonePayloadType): void => {
		published.push(payload)
	}
	subscribeToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, onPublish)
	const interactionId = randomUUID()
	const run = runSpeculativeTurn(
		{ domia, features },
		{
			interactionId,
			release: opts.release,
			decodeSpeculation: opts.decodeSpeculation ?? false,
			captureFactory: (h) => {
				hooks = h
				return capture
			},
		},
	)
	return {
		domia,
		llm,
		stt,
		published,
		eager: () => hooks?.onSpeculate(fabricateSegmentPcm("speech", 200)),
		resume: () => hooks?.onResume(fabricateSegmentPcm("speech", 200)),
		finish: async (): Promise<SttDonePayloadType | undefined> => {
			resolveFinalPcm(fabricateSegmentPcm("speech", 200))
			await run
			await sleep(SETTLE_MS)
			unsubscribeFromDomiaBus(
				domia.id,
				DOMIA_EVENT_BUS_ENUM.STT_DONE,
				onPublish,
			)
			return published[0]
		},
	}
}

const runSpeculativeTurnChecks = async (): Promise<void> => {
	console.log(
		"\neager tier through the real runSpeculativeTurn (synthetic partial feed via captureFactory)",
	)

	const partialText = { value: "turn off the" }
	const a = makeHarness({
		partial: () => partialText.value,
		final: () => "turn off the lights",
	})
	await sleep(SETTLE_MS)
	a.eager()
	await sleep(SETTLE_MS * 2)
	checker.check(
		"acoustic eager endpoint → exactly one prefill with the partial in the prompt",
		a.llm.calls.length === 1 && a.llm.calls[0].prompt.includes("turn off the"),
		`calls=${a.llm.calls.length}`,
	)
	const aPayload = await a.finish()
	checker.check(
		"final extends the partial → STT_DONE carries a reusable eager handle",
		aPayload?.eagerPrefill?.relation === "extends" &&
			aPayload.eagerPrefill.partial === "turn off the" &&
			aPayload.transcript === "turn off the lights" &&
			a.stt.finishCalls() === 1,
		JSON.stringify({
			relation: aPayload?.eagerPrefill?.relation,
			transcript: aPayload?.transcript,
		}),
	)
	checker.check(
		"eager-only turn takes no early voice admission (no prestartedRelease, no prestarted tokens)",
		aPayload !== undefined &&
			aPayload.prestartedRelease === undefined &&
			aPayload.prestartedTokens === undefined &&
			activeVoiceReplies(a.domia.id) === 0,
	)
	const settledStart = Date.now()
	await settleEagerPrefill(
		aPayload?.eagerPrefill,
		"two-tier-eval",
		DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
	)
	checker.check(
		"settleEagerPrefill awaits the hot prefill before decode",
		Date.now() - settledStart < 500 && a.llm.calls[0].signal?.aborted === false,
	)

	const b = makeHarness({
		holdMs: 5000,
		partial: () => "turn off the",
		final: () => "turn off the lights please",
	})
	await sleep(SETTLE_MS)
	b.eager()
	await sleep(SETTLE_MS * 2)
	b.resume()
	await sleep(SETTLE_MS)
	checker.check(
		"speech resumes while the prefill is in flight → the prefill request is aborted",
		b.llm.calls.length === 1 && b.llm.calls[0].signal?.aborted === true,
		`calls=${b.llm.calls.length} aborted=${String(b.llm.calls[0]?.signal?.aborted)}`,
	)
	b.eager()
	await sleep(SETTLE_MS * 2)
	checker.check(
		"next eager endpoint after resume → a second prefill generation",
		b.llm.calls.length === 2 && b.llm.calls[1].signal?.aborted === false,
		`calls=${b.llm.calls.length}`,
	)
	const bPayload = await b.finish()
	checker.check(
		"final after resume reuses the second generation",
		bPayload?.eagerPrefill?.relation === "extends",
		JSON.stringify(bPayload?.eagerPrefill?.relation),
	)
	bPayload?.eagerPrefill?.cancel("eval done")

	const c = makeHarness({
		partial: () => "turn on the lights",
		final: () => "play some jazz",
	})
	await sleep(SETTLE_MS)
	c.eager()
	await sleep(SETTLE_MS * 2)
	const cPayload = await c.finish()
	checker.check(
		"final diverges → handle says diverges and settle cancels instead of waiting",
		cPayload?.eagerPrefill?.relation === "diverges",
		JSON.stringify(cPayload?.eagerPrefill?.relation),
	)
	let cancelled = false
	const divergent: EagerPrefillHandleType = {
		partial: "x",
		relation: "diverges",
		settled: new Promise<void>(() => undefined),
		cancel: () => {
			cancelled = true
		},
	}
	await settleEagerPrefill(
		divergent,
		"two-tier-eval",
		DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
	)
	checker.check(
		"settleEagerPrefill never waits on a divergent prefill",
		cancelled,
	)

	const stuck = { cancels: 0 }
	const neverSettles: EagerPrefillHandleType = {
		partial: "x",
		relation: "extends",
		settled: new Promise<void>(() => undefined),
		cancel: () => {
			stuck.cancels += 1
		},
	}
	const stuckStart = Date.now()
	const stuckOutcome = await settleEagerPrefill(
		neverSettles,
		"two-tier-eval",
		50,
	)
	const stuckWaitMs = Date.now() - stuckStart
	checker.check(
		"a never-settling prefill falls back to decode within the settle wait",
		stuckOutcome === "decode" && stuck.cancels === 1 && stuckWaitMs < 1000,
		`outcome=${stuckOutcome} cancels=${stuck.cancels} waited=${stuckWaitMs}ms`,
	)

	let released = 0
	const off = makeHarness({
		wakeWord: { twoTierEndpointEnabled: false },
		release: () => {
			released += 1
		},
		partial: () => "turn off the",
		final: () => "turn off the lights",
	})
	await sleep(SETTLE_MS)
	off.eager()
	await sleep(SETTLE_MS * 2)
	const offPayload = await off.finish()
	checker.check(
		"flag OFF → zero prefills, no eager handle, publish shape identical to today",
		off.llm.calls.length === 0 &&
			offPayload !== undefined &&
			offPayload.eagerPrefill === undefined &&
			offPayload.prestartedTokens === undefined &&
			typeof offPayload.prestartedRelease === "function" &&
			offPayload.transcript === "turn off the lights",
		`calls=${off.llm.calls.length}`,
	)
	offPayload?.prestartedRelease?.()
	checker.check(
		"flag OFF → the admitted release still travels to STT_DONE",
		released === 1,
	)

	const capped = makeHarness({
		wakeWord: { twoTierMaxEagerPrefills: 1 },
		holdMs: 5000,
		partial: () => "turn off the lights",
		final: () => "turn off the lights",
	})
	await sleep(SETTLE_MS)
	capped.eager()
	await sleep(SETTLE_MS * 2)
	capped.resume()
	await sleep(SETTLE_MS)
	capped.eager()
	await sleep(SETTLE_MS * 2)
	checker.check(
		"twoTierMaxEagerPrefills=1 → the second eager endpoint issues no prefill",
		capped.llm.calls.length === 1,
		`calls=${capped.llm.calls.length}`,
	)
	const cappedPayload = await capped.finish()
	checker.check(
		"cancelled-only turn → final decodes without an eager handle",
		cappedPayload?.eagerPrefill === undefined,
	)

	const short = makeHarness({
		wakeWord: { twoTierEagerMinPartialChars: 12 },
		partial: () => "turn off",
		final: () => "turn off the lights",
	})
	await sleep(SETTLE_MS)
	short.eager()
	await sleep(SETTLE_MS * 2)
	checker.check(
		"partial below twoTierEagerMinPartialChars → no prefill",
		short.llm.calls.length === 0,
		`calls=${short.llm.calls.length}`,
	)
	await short.finish()

	const both = makeHarness({
		decodeSpeculation: true,
		release: () => undefined,
		partial: () => "turn off the lights",
		final: () => "turn off the lights",
	})
	await sleep(SETTLE_MS)
	both.eager()
	await sleep(SETTLE_MS * 3)
	const bothPayload = await both.finish()
	checker.check(
		"decode speculation ON owns the generation: LLM stream started, no eager prefill",
		both.llm.streams() === 1 &&
			both.llm.calls.length === 0 &&
			bothPayload?.prestartedTokens !== undefined &&
			bothPayload.eagerPrefill === undefined,
		`streams=${both.llm.streams()} prefills=${both.llm.calls.length}`,
	)
	const stale = bothPayload?.prestartedTokens as
		| AsyncGenerator<string>
		| undefined
	void stale?.return(undefined).catch(() => undefined)
}

const runArmingChecks = async (): Promise<void> => {
	console.log("\narming (local features gate + satellite speculation entry)")
	const llm = makeLlm(10)
	const features = {
		llm: { adapter: llm.adapter, canStream: true },
		canRunLlm: true,
	} as CoreBusFeaturesType
	const offDomia = getDomia({
		wakeWordConfigOverrides: { speculativeSilenceMs: 300 },
	})
	const onDomia = getDomia({
		wakeWordConfigOverrides: {
			twoTierEndpointEnabled: true,
			speculativeSilenceMs: 300,
		},
	})
	checker.check(
		"twoTierEndpointArmed: OFF by default, ON needs flag + silence window + prefill-capable LLM",
		!twoTierEndpointArmed(offDomia, features) &&
			twoTierEndpointArmed(onDomia, features) &&
			!twoTierEndpointArmed(onDomia, {
				...features,
				llm: {
					adapter: { ...llm.adapter, prefill: undefined },
					canStream: true,
				},
			}) &&
			!twoTierEndpointArmed(onDomia, { ...features, canRunLlm: false }),
	)

	const satDomia = getDomia({
		wakeWordConfigOverrides: {
			satelliteSpeculationEnabled: false,
			twoTierEndpointEnabled: true,
			speculativeSilenceMs: 300,
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
	const fake = makeSession(
		() => "never mind",
		() => "never mind",
	)
	const spec = await startSatelliteSpeculation({
		identity: satDomia,
		interactionId: randomUUID(),
		sttSession: () => fake.session,
		vadDebounceMs: 750,
		bufferedPcm: () => fabricateSegmentPcm("speech", 300),
	})
	checker.check(
		"satellite: decode speculation off + LLM delegated → two-tier does not arm (origin has no local prefill)",
		spec === null,
	)
	spec?.abort("eval")

	const satLocal = getDomia({
		wakeWordConfigOverrides: {
			satelliteSpeculationEnabled: false,
			twoTierEndpointEnabled: true,
			speculativeSilenceMs: 300,
			vadMinSilenceS: 0.5,
			vadEndOfSpeechMs: 250,
			vadThreshold: 0.35,
			numThreads: 1,
			provider: "cpu",
			sampleRate: 16000,
		},
		llmModelConfigOverrides: {
			engine: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
			baseUrl: "http://127.0.0.1:1",
			slotAffinityEnabled: false,
		},
		runtimeCapabilitiesOverrides: { llm: true, tts: false },
		moduleSettingsOverrides: {
			memoryEngine: false,
			emotionEngine: false,
			factRecall: false,
			skillsEngine: false,
		},
	})
	const before = activeVoiceReplies(satLocal.id)
	const specLocal = await startSatelliteSpeculation({
		identity: satLocal,
		interactionId: randomUUID(),
		sttSession: () => fake.session,
		vadDebounceMs: 750,
		bufferedPcm: () => fabricateSegmentPcm("speech", 300),
	})
	checker.check(
		"satellite: two-tier arms without satelliteSpeculationEnabled/TTS and takes no voice admission",
		specLocal !== null && activeVoiceReplies(satLocal.id) === before,
		`armed=${String(specLocal !== null)} active=${activeVoiceReplies(satLocal.id)}`,
	)
	specLocal?.abort("eval")
	await specLocal?.done.catch(() => undefined)
}

const main = async (): Promise<void> => {
	runTrackerChecks()
	await runSpeculativeTurnChecks()
	await runArmingChecks()
	console.log(
		`\ntwo-tier endpoint: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	process.exit(checker.failCount() > 0 ? 1 : 0)
}

void main().catch((err: unknown) => {
	console.error(err)
	process.exit(1)
})

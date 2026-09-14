import {
	DEFAULT_VAD_THRESHOLD,
	DEFAULT_VOICE_FEEL_COOLDOWN_MS,
	DEFAULT_VOICE_FEEL_DAILY_BUDGET,
	DEFAULT_VOICE_FEEL_RULES,
	IMPLICIT_FEEDBACK_ENUM,
	INTERACTION_STATUS_ENUM,
} from "@/db/constants"
import { classifyChange } from "@/modules/config-apply/utils"
import {
	VOICE_FEEL_FEATURE_KEYS,
	VOICE_FEEL_KNOB_DEFAULTS,
	computeVoiceFeelFeatures,
	createVoiceFeelEngine,
	shouldRevert,
} from "@/modules/voice-feel"
import type {
	VoiceFeelConfigType,
	VoiceFeelFeaturesType,
	VoiceFeelLedgerEntryType,
	VoiceFeelLimitsType,
	VoiceFeelRuleType,
	VoiceFeelTraceRowType,
} from "@/modules/voice-feel"

import { makeChecker } from "./lib"

const { check, passCount, failCount } = makeChecker()

const NOW = 1_700_000_000_000
const HOUR_MS = 3_600_000
const REPLY = "x".repeat(100)

const row = (
	partial: Partial<VoiceFeelTraceRowType>,
): VoiceFeelTraceRowType => ({
	status: INTERACTION_STATUS_ENUM.OK,
	...partial,
})

const bargeIn = (heardChars: number): VoiceFeelTraceRowType =>
	row({
		implicitFeedback: IMPLICIT_FEEDBACK_ENUM.BARGE_IN,
		llmResponse: REPLY,
		heardReply: "x".repeat(heardChars),
		sttResult: "turn on the light.",
	})

const answered = (
	perceivedTtfaMs: number | null,
	eouDelayMs: number | null,
): VoiceFeelTraceRowType =>
	row({
		sttResult: "okay thanks.",
		perceivedTtfaMs,
		eouDelayMs,
		endpointDebounceMs: 350,
	})

const WINDOW: VoiceFeelTraceRowType[] = [
	bargeIn(10),
	bargeIn(15),
	bargeIn(20),
	bargeIn(50),
	row({ sttResult: "turn on the" }),
	row({ sttResult: "turn on the" }),
	row({ sttResult: "and then i wanted to" }),
	row({ sttResult: "um" }),
	answered(1000, 300),
	answered(1200, 400),
	answered(1400, 500),
	answered(1600, 600),
	answered(null, null),
	answered(null, null),
	answered(null, null),
	answered(null, null),
	row({ status: INTERACTION_STATUS_ENUM.NO_SPEECH, sttResult: null }),
	row({ status: INTERACTION_STATUS_ENUM.NO_SPEECH, sttResult: null }),
	row({ sttResult: null }),
	row({ sttResult: null }),
]

const EXPECTED_FEATURES: VoiceFeelFeaturesType = {
	turns: 20,
	earlyBargeInRate: 0.15,
	lateBargeInRate: 0.05,
	cutOffRate: 0.25,
	perceivedTtfaP50: 1200,
	eouDelayP50: 400,
	noSpeechRate: 0.1,
}

const features = (
	over: Partial<VoiceFeelFeaturesType>,
): VoiceFeelFeaturesType => ({
	turns: 20,
	earlyBargeInRate: 0,
	lateBargeInRate: 0,
	cutOffRate: 0,
	perceivedTtfaP50: 800,
	eouDelayP50: 200,
	noSpeechRate: 0,
	...over,
})

const LIMITS: VoiceFeelLimitsType = {
	defaults: {
		...VOICE_FEEL_KNOB_DEFAULTS,
		"wakeWord.vadThreshold": DEFAULT_VAD_THRESHOLD,
		"stt.numThreads": 4,
	},
	dailyBudget: DEFAULT_VOICE_FEEL_DAILY_BUDGET,
	cooldownMs: DEFAULT_VOICE_FEEL_COOLDOWN_MS,
	now: () => NOW,
}

const engine = createVoiceFeelEngine(LIMITS)

const current = (
	over: Partial<Record<string, Record<string, unknown>>> = {},
): VoiceFeelConfigType => ({
	wakeWord: {
		vadMinSilenceS: 0.5,
		endpointIncompleteMs: 900,
		endpointCompleteMs: 350,
		vadThreshold: DEFAULT_VAD_THRESHOLD,
	},
	llm: { numPredict: 80 },
	stt: { numThreads: 4 },
	...over,
})

const ruleById = (id: string): VoiceFeelRuleType => {
	const found = DEFAULT_VOICE_FEEL_RULES.find((rule) => rule.id === id)
	if (!found) throw new Error(`unknown rule ${id}`)
	return { ...found, when: [...found.when], knob: { ...found.knob } }
}

const ledgerEntry = (
	section: string,
	field: string,
	ageMs: number,
): VoiceFeelLedgerEntryType => ({
	ruleId: "prior",
	section,
	field,
	at: NOW - ageMs,
})

const main = () => {
	console.log("\n🎚️  voice-feel features")
	const computed = computeVoiceFeelFeatures(WINDOW)
	for (const key of VOICE_FEEL_FEATURE_KEYS)
		check(
			`features: ${key} = ${EXPECTED_FEATURES[key]}`,
			computed[key] === EXPECTED_FEATURES[key],
			`got ${computed[key]}`,
		)
	check(
		"features: empty window is all zeros",
		VOICE_FEEL_FEATURE_KEYS.every(
			(key) => computeVoiceFeelFeatures([])[key] === 0,
		),
	)

	console.log("\n🎚️  rule table")
	check(
		"rules: ids and order match the plan",
		DEFAULT_VOICE_FEEL_RULES.map((rule) => rule.id).join(",") ===
			"cut-off-user,early-barge-in,late-barge-in,slow-ttfa",
	)
	check(
		"rules: late-barge-in ships disabled",
		!ruleById("late-barge-in").enabled,
	)
	check(
		"rules: every shipped knob is a live field",
		DEFAULT_VOICE_FEEL_RULES.every(
			(rule) => classifyChange(rule.knob.section, rule.knob.field) === "live",
		),
	)
	check(
		"rules: every shipped knob has a clamp default",
		DEFAULT_VOICE_FEEL_RULES.every(
			(rule) =>
				typeof VOICE_FEEL_KNOB_DEFAULTS[
					`${rule.knob.section}.${rule.knob.field}`
				] === "number",
		),
	)

	console.log("\n🎚️  per-rule recommendations")
	const cutOff = engine.evaluate(
		DEFAULT_VOICE_FEEL_RULES,
		features({ cutOffRate: 0.3 }),
		current(),
		[],
	)
	check(
		"cut-off-user: vadMinSilenceS 0.5 → 0.6",
		cutOff?.ruleId === "cut-off-user" &&
			cutOff.section === "wakeWord" &&
			cutOff.field === "vadMinSilenceS" &&
			cutOff.from === 0.5 &&
			cutOff.to === 0.6,
		JSON.stringify(cutOff && { ...cutOff, features: undefined }),
	)
	check(
		"cut-off-user: carries sample size and confidence",
		cutOff?.sampleSize === 20 &&
			cutOff.confidence > 0 &&
			cutOff.confidence <= 1 &&
			cutOff.features.cutOffRate === 0.3,
		`${cutOff?.confidence}`,
	)

	const early = engine.evaluate(
		DEFAULT_VOICE_FEEL_RULES,
		features({ earlyBargeInRate: 0.3 }),
		current(),
		[],
	)
	check(
		"early-barge-in: vadMinSilenceS 0.5 → 0.6",
		early?.ruleId === "early-barge-in" && early.to === 0.6,
		JSON.stringify(early && { ...early, features: undefined }),
	)

	check(
		"late-barge-in: disabled rule never fires",
		engine.evaluate(
			DEFAULT_VOICE_FEEL_RULES,
			features({ lateBargeInRate: 0.5 }),
			current(),
			[],
		) === null,
	)
	const late = engine.evaluate(
		[{ ...ruleById("late-barge-in"), enabled: true }],
		features({ lateBargeInRate: 0.5 }),
		current(),
		[],
	)
	check(
		"late-barge-in: numPredict 80 → 64 (rule floor beats the −50 % clamp)",
		late?.ruleId === "late-barge-in" &&
			late.section === "llm" &&
			late.from === 80 &&
			late.to === 64,
		JSON.stringify(late && { ...late, features: undefined }),
	)

	const slow = engine.evaluate(
		DEFAULT_VOICE_FEEL_RULES,
		features({ perceivedTtfaP50: 2200, eouDelayP50: 700, cutOffRate: 0.05 }),
		current(),
		[],
	)
	check(
		"slow-ttfa: vadMinSilenceS 0.5 → 0.45",
		slow?.ruleId === "slow-ttfa" && slow.to === 0.45,
		JSON.stringify(slow && { ...slow, features: undefined }),
	)
	check(
		"slow-ttfa: held back while the user is being cut off",
		engine.evaluate(
			DEFAULT_VOICE_FEEL_RULES,
			features({ perceivedTtfaP50: 2200, eouDelayP50: 700, cutOffRate: 0.2 }),
			current(),
			[],
		)?.ruleId !== "slow-ttfa",
	)
	check(
		"quiet window: no rule fires",
		engine.evaluate(DEFAULT_VOICE_FEEL_RULES, features({}), current(), []) ===
			null,
	)

	console.log("\n🎚️  safety rails")
	check(
		"minTurns: 10 turns under the 15-turn floor → null",
		engine.evaluate(
			DEFAULT_VOICE_FEEL_RULES,
			features({ cutOffRate: 0.3, turns: 10 }),
			current(),
			[],
		) === null,
	)

	const clamped = engine.evaluate(
		DEFAULT_VOICE_FEEL_RULES,
		features({ cutOffRate: 0.3 }),
		current({ wakeWord: { vadMinSilenceS: 0.7 } }),
		[],
	)
	check(
		"clamp: 0.7 + 0.1 lands on the +50 % ceiling 0.75",
		clamped?.to === 0.75,
		JSON.stringify(clamped && { ...clamped, features: undefined }),
	)
	check(
		"clamp: already at the ceiling → null",
		engine.evaluate(
			DEFAULT_VOICE_FEEL_RULES,
			features({ cutOffRate: 0.3 }),
			current({ wakeWord: { vadMinSilenceS: 0.75 } }),
			[],
		) === null,
	)
	check(
		"clamp: slow-ttfa stops at the −50 % floor 0.3",
		engine.evaluate(
			DEFAULT_VOICE_FEEL_RULES,
			features({ perceivedTtfaP50: 2200, eouDelayP50: 700, cutOffRate: 0.05 }),
			current({ wakeWord: { vadMinSilenceS: 0.31 } }),
			[],
		)?.to === 0.3,
	)

	const forbidden: VoiceFeelRuleType = {
		...ruleById("cut-off-user"),
		id: "forbidden-knob",
		knob: { section: "wakeWord", field: "vadThreshold" },
		step: 0.05,
		min: 0.1,
		max: 0.9,
	}
	check(
		"forbidden: a rule naming vadThreshold emits nothing",
		engine.evaluate(
			[forbidden],
			features({ cutOffRate: 0.3 }),
			current(),
			[],
		) === null,
	)
	check(
		"forbidden: the same knob is live and defaulted, so only the rail blocks it",
		classifyChange("wakeWord", "vadThreshold") === "live" &&
			typeof LIMITS.defaults["wakeWord.vadThreshold"] === "number",
	)

	const nonLive: VoiceFeelRuleType = {
		...ruleById("cut-off-user"),
		id: "non-live-knob",
		knob: { section: "stt", field: "numThreads" },
		step: 1,
		min: 1,
		max: 8,
	}
	check(
		"live-only: an stt-pool field is ignored",
		engine.evaluate([nonLive], features({ cutOffRate: 0.3 }), current(), []) ===
			null && classifyChange("stt", "numThreads") === "stt-pool",
	)

	const budgetLedger = Array.from(
		{ length: DEFAULT_VOICE_FEEL_DAILY_BUDGET },
		() => ledgerEntry("llm", "numPredict", HOUR_MS),
	)
	check(
		"budget: exhausted daily budget → null",
		engine.evaluate(
			DEFAULT_VOICE_FEEL_RULES,
			features({ cutOffRate: 0.3 }),
			current(),
			budgetLedger,
		) === null,
	)
	check(
		"budget: one slot left still recommends",
		engine.evaluate(
			DEFAULT_VOICE_FEEL_RULES,
			features({ cutOffRate: 0.3 }),
			current(),
			budgetLedger.slice(1),
		)?.ruleId === "cut-off-user",
	)
	check(
		"budget: yesterday's adjustments do not count",
		engine.evaluate(
			DEFAULT_VOICE_FEEL_RULES,
			features({ cutOffRate: 0.3 }),
			current(),
			budgetLedger.map((entry) => ({ ...entry, at: NOW - 25 * HOUR_MS })),
		)?.ruleId === "cut-off-user",
	)

	const hot = features({ cutOffRate: 0.3, lateBargeInRate: 0.4 })
	const withLateBargeIn = DEFAULT_VOICE_FEEL_RULES.map((rule) =>
		rule.id === "late-barge-in" ? { ...rule, enabled: true } : rule,
	)
	check(
		"priority: two rules fire, only the first is returned",
		engine.evaluate(withLateBargeIn, hot, current(), [])?.ruleId ===
			"cut-off-user",
	)
	check(
		"cooldown: the knob on cooldown is skipped, another knob still fires",
		engine.evaluate(withLateBargeIn, hot, current(), [
			ledgerEntry("wakeWord", "vadMinSilenceS", HOUR_MS),
		])?.ruleId === "late-barge-in",
	)
	check(
		"cooldown: expired entry no longer blocks",
		engine.evaluate(DEFAULT_VOICE_FEEL_RULES, hot, current(), [
			ledgerEntry("wakeWord", "vadMinSilenceS", 7 * HOUR_MS),
		])?.ruleId === "cut-off-user",
	)

	console.log("\n🎚️  revert")
	const cutOffRule = ruleById("cut-off-user")
	check(
		"revert: driving rate worsened by 33 % → inverse delta",
		JSON.stringify(
			shouldRevert(
				features({ cutOffRate: 0.3 }),
				features({ cutOffRate: 0.4 }),
				cutOffRule,
			),
		) ===
			JSON.stringify({
				section: "wakeWord",
				field: "vadMinSilenceS",
				step: -0.1,
			}),
	)
	check(
		"revert: 10 % worse stays inside the 25 % band → null",
		shouldRevert(
			features({ cutOffRate: 0.3 }),
			features({ cutOffRate: 0.33 }),
			cutOffRule,
		) === null,
	)
	check(
		"revert: an improved window is never reverted",
		shouldRevert(
			features({ cutOffRate: 0.3 }),
			features({ cutOffRate: 0.1 }),
			cutOffRule,
		) === null,
	)
	const slowRevert = shouldRevert(
		features({ perceivedTtfaP50: 2000 }),
		features({ perceivedTtfaP50: 2600 }),
		ruleById("slow-ttfa"),
	)
	check(
		"revert: slow-ttfa inverts its own negative step",
		slowRevert?.step === 0.05 && slowRevert.field === "vadMinSilenceS",
		JSON.stringify(slowRevert),
	)

	const small = engine.evaluate(
		DEFAULT_VOICE_FEEL_RULES,
		features({ cutOffRate: 0.3, turns: 15 }),
		current(),
		[],
	)
	const large = engine.evaluate(
		DEFAULT_VOICE_FEEL_RULES,
		features({ cutOffRate: 0.3, turns: 60 }),
		current(),
		[],
	)
	check(
		"confidence: grows with the sample size",
		Boolean(small && large && large.confidence > small.confidence),
		`${small?.confidence} → ${large?.confidence}`,
	)

	console.log(`\n${passCount()}/${passCount() + failCount()} checks passed`)
	process.exit(failCount() === 0 ? 0 : 1)
}

main()

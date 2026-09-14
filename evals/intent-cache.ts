import type { DomiaType } from "@/modules/core"
import {
	intentCacheScope,
	intentCacheStats,
	isIntentCacheEnabled,
	lookupIntentCacheExact,
	lookupIntentCacheSemantic,
	rememberIntentDecision,
	resetIntentCache,
	normalizeIntentTranscript,
	intentToolSetHash,
	type IntentDecisionType,
	type IntentToolHintType,
} from "@/modules/intent-router"
import { baseDomia, baseLlmModelConfig } from "@/test-utils/mocks"

import { makeChecker } from "./lib"

const checker = makeChecker()

const BASE_LLM = baseLlmModelConfig()

const TOOLS: IntentToolHintType[] = [
	{ name: "HassTurnOn", description: "Turn a device on" },
	{ name: "HassTurnOff", description: "Turn a device off" },
]

const MORE_TOOLS: IntentToolHintType[] = [
	...TOOLS,
	{ name: "GetLiveContext", description: "Read live device state" },
]

const domiaWith = (over: Partial<DomiaType> = {}): DomiaType => ({
	...baseDomia,
	domiaKey: "DOMIA_EVAL",
	configRevision: 1,
	runtimeCapabilities: null,
	emotionState: null,
	characterProfile: null,
	moduleSettings: null,
	wakeWordConfig: null,
	sttConfig: null,
	llmModelConfig: BASE_LLM,
	ttsConfig: null,
	audioPlaybackConfig: null,
	skillProviders: null,
	localMqttConfig: null,
	capabilityDelegations: null,
	...over,
})

const normalize = (vec: number[]): number[] => {
	const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
	return vec.map((v) => v / norm)
}

const DIMS = 64

const axis = (index: number): number[] =>
	Array.from({ length: DIMS }, (_, i) => (i === index ? 1 : 0))

const blend = (tilt: number): number[] =>
	normalize(axis(0).map((v, i) => (i === 1 ? tilt : v)))

const skill: IntentDecisionType = { needsSkill: true, reason: "classified" }
const chat: IntentDecisionType = { needsSkill: false, reason: "embedding:0.21" }

const runNormalizationChecks = (): void => {
	console.log("\nintent cache — key normalization")
	checker.check(
		"case, punctuation and accents fold to one key",
		normalizeIntentTranscript("¿Enciende la LUZ, por favor?") ===
			normalizeIntentTranscript("enciende la luz por favor"),
	)
	checker.check(
		"different words keep different keys",
		normalizeIntentTranscript("turn on the light") !==
			normalizeIntentTranscript("turn off the light"),
	)
	checker.check(
		"tool-set hash is order independent",
		intentToolSetHash(TOOLS) === intentToolSetHash([...TOOLS].reverse()),
	)
	checker.check(
		"tool-set hash changes when a tool is offered",
		intentToolSetHash(TOOLS) !== intentToolSetHash(MORE_TOOLS),
	)
}

const runExactChecks = (): void => {
	console.log("\nintent cache — exact hits")
	resetIntentCache()
	const domia = domiaWith()
	const scope = intentCacheScope(domia, TOOLS)
	checker.check("cache enabled by default", isIntentCacheEnabled(domia))
	checker.check(
		"cold lookup misses",
		lookupIntentCacheExact(scope, "turn on the kitchen light") === null,
	)
	rememberIntentDecision(domia, scope, "turn on the kitchen light", null, skill)
	const hit = lookupIntentCacheExact(scope, "Turn on the kitchen light!")
	checker.check(
		"warm lookup hits with cache reason",
		hit?.needsSkill === true && hit.reason === "cache:1.00",
		`got=${JSON.stringify(hit)}`,
	)
	checker.check(
		"a different utterance still misses",
		lookupIntentCacheExact(scope, "what time is it") === null,
	)
	const stats = intentCacheStats()
	checker.check(
		"stats count one entry and one exact hit",
		stats.entries === 1 && stats.exactHits === 1,
		JSON.stringify(stats),
	)
}

const runScopeChecks = (): void => {
	console.log("\nintent cache — scope invalidation")
	resetIntentCache()
	const domia = domiaWith()
	const scope = intentCacheScope(domia, TOOLS)
	rememberIntentDecision(domia, scope, "turn on the light", null, skill)
	const widened = intentCacheScope(domia, MORE_TOOLS)
	checker.check(
		"a changed tool set misses",
		widened !== scope &&
			lookupIntentCacheExact(widened, "turn on the light") === null,
	)
	const retuned = intentCacheScope(
		domiaWith({
			llmModelConfig: { ...BASE_LLM, intentEmbedThreshold: 0.9 },
		}),
		TOOLS,
	)
	checker.check(
		"a retuned routing threshold misses",
		retuned !== scope &&
			lookupIntentCacheExact(retuned, "turn on the light") === null,
	)
	const relanguaged = intentCacheScope(
		domiaWith({
			characterProfile: { language: "es" } as DomiaType["characterProfile"],
		}),
		TOOLS,
	)
	checker.check(
		"a language change misses",
		relanguaged !== scope &&
			lookupIntentCacheExact(relanguaged, "turn on the light") === null,
	)
	const redescribed = intentCacheScope(
		domia,
		TOOLS.map((t) => ({ ...t, description: `${t.description} (v2)` })),
	)
	checker.check(
		"a changed tool description misses",
		redescribed !== scope &&
			lookupIntentCacheExact(redescribed, "turn on the light") === null,
	)
	const unrelated = intentCacheScope(domiaWith({ configRevision: 99 }), TOOLS)
	checker.check(
		"an unrelated config write still hits",
		unrelated === scope &&
			lookupIntentCacheExact(unrelated, "turn on the light") !== null,
	)
	const other = intentCacheScope(domiaWith({ domiaKey: "DOMIA_OTHER" }), TOOLS)
	checker.check(
		"another identity misses",
		lookupIntentCacheExact(other, "turn on the light") === null,
	)
	checker.check(
		"the original scope still hits",
		lookupIntentCacheExact(scope, "turn on the light")?.needsSkill === true,
	)
	resetIntentCache()
	checker.check(
		"resetIntentCache drops every entry",
		lookupIntentCacheExact(scope, "turn on the light") === null &&
			intentCacheStats().entries === 0,
	)
}

const runSemanticChecks = (): void => {
	console.log("\nintent cache — semantic hits")
	resetIntentCache()
	const domia = domiaWith()
	const scope = intentCacheScope(domia, TOOLS)
	const anchor = axis(0)
	rememberIntentDecision(domia, scope, "turn on the light", anchor, skill)
	const near = blend(0.1)
	const mid = blend(0.8)
	const far = axis(1)
	const hit = lookupIntentCacheSemantic(domia, scope, near)
	checker.check(
		"a near-identical embedding hits",
		hit?.needsSkill === true && hit.reason.startsWith("cache:"),
		`got=${JSON.stringify(hit)}`,
	)
	checker.check(
		"a merely similar embedding misses at the default threshold",
		lookupIntentCacheSemantic(domia, scope, mid) === null,
	)
	checker.check(
		"an unrelated embedding misses",
		lookupIntentCacheSemantic(domia, scope, far) === null,
	)
	const loose = domiaWith({
		llmModelConfig: { ...BASE_LLM, intentCacheMinSimilarity: 0.5 },
	})
	const loosened = lookupIntentCacheSemantic(loose, scope, mid)
	checker.check(
		"a lowered threshold accepts the merely similar embedding",
		loosened?.needsSkill === true && loosened.reason === "cache:0.78",
		`got=${JSON.stringify(loosened)}`,
	)
	checker.check(
		"even a lowered threshold rejects an orthogonal embedding",
		lookupIntentCacheSemantic(loose, scope, far) === null,
	)
	const otherScope = intentCacheScope(domia, MORE_TOOLS)
	checker.check(
		"a changed tool set is never served semantically",
		lookupIntentCacheSemantic(domia, otherScope, near) === null,
	)
}

const runFailClosedChecks = (): void => {
	console.log("\nintent cache — never cache a fail-closed decision")
	resetIntentCache()
	const domia = domiaWith()
	const scope = intentCacheScope(domia, TOOLS)
	const vec = axis(2)
	rememberIntentDecision(domia, scope, "set the thing to eleven", vec, {
		needsSkill: false,
		reason: "classify-failed",
	})
	checker.check(
		"classify-failed is not cached",
		lookupIntentCacheExact(scope, "set the thing to eleven") === null &&
			lookupIntentCacheSemantic(domia, scope, vec) === null,
	)
	rememberIntentDecision(domia, scope, "any local model there", vec, {
		needsSkill: false,
		reason: "no-local-llm",
	})
	checker.check(
		"no-local-llm is not cached",
		lookupIntentCacheExact(scope, "any local model there") === null,
	)
	rememberIntentDecision(domia, scope, "a cached echo", vec, {
		needsSkill: true,
		reason: "cache:0.99",
	})
	checker.check(
		"a cache hit is never re-stored",
		lookupIntentCacheExact(scope, "a cached echo") === null,
	)
	rememberIntentDecision(domia, scope, "is the light on", vec, chat)
	checker.check(
		"a real chat verdict is cached",
		lookupIntentCacheExact(scope, "is the light on")?.needsSkill === false,
	)
}

const runEvictionChecks = (): void => {
	console.log("\nintent cache — LRU eviction")
	resetIntentCache()
	const domia = domiaWith({
		llmModelConfig: { ...BASE_LLM, intentCacheSize: 3 },
	})
	const scope = intentCacheScope(domia, TOOLS)
	for (const text of ["one", "two", "three"])
		rememberIntentDecision(domia, scope, text, null, skill)
	checker.check(
		"the cache fills to its bound",
		intentCacheStats().entries === 3,
		`entries=${intentCacheStats().entries}`,
	)
	checker.check(
		"oldest is still resident",
		lookupIntentCacheExact(scope, "one") !== null,
	)
	rememberIntentDecision(domia, scope, "four", null, skill)
	checker.check(
		"the least recently used entry is evicted",
		intentCacheStats().entries === 3 &&
			lookupIntentCacheExact(scope, "two") === null,
	)
	checker.check(
		"a recently touched entry survives",
		lookupIntentCacheExact(scope, "one") !== null &&
			lookupIntentCacheExact(scope, "four") !== null,
	)
}

const runDisabledChecks = (): void => {
	console.log("\nintent cache — disabled")
	const off = domiaWith({
		llmModelConfig: { ...BASE_LLM, intentCacheEnabled: false },
	})
	checker.check("the flag turns the cache off", !isIntentCacheEnabled(off))
}

const main = (): void => {
	runNormalizationChecks()
	runExactChecks()
	runScopeChecks()
	runSemanticChecks()
	runFailClosedChecks()
	runEvictionChecks()
	runDisabledChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} intent-cache checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

main()

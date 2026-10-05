import type { DomiaType } from "@/modules/core"
import {
	intentCacheStats,
	isIntentCacheEnabled,
	judgeCacheScope,
	judgeRequestOf,
	lookupJudgeCache,
	normalizeIntentTranscript,
	rememberJudgeVerdict,
	resetIntentCache,
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

const requestFor = (tools: IntentToolHintType[]) => {
	const request = judgeRequestOf("x", tools)
	if (!request) throw new Error("judge request did not fit")
	return request
}

const run = (): void => {
	resetIntentCache()
	const domia = domiaWith()
	const scope = judgeCacheScope(domia, requestFor(TOOLS))

	console.log("\nthe judge cache answers an exact repeat of a sentence")
	checker.check(
		"an unknown sentence misses",
		lookupJudgeCache(scope, "Turn on the kitchen light") === null,
	)
	rememberJudgeVerdict(domia, scope, "Turn on the kitchen light", {
		tool: "HassTurnOn",
		failed: false,
	})
	checker.check(
		"the same sentence hits with the named tool",
		lookupJudgeCache(scope, "Turn on the kitchen light")?.tool === "HassTurnOn",
	)
	checker.check(
		"punctuation, case and accents do not change the key",
		normalizeIntentTranscript("  Turn ON the kitchen light!  ") ===
			normalizeIntentTranscript("turn on the kitchen light") &&
			lookupJudgeCache(scope, "turn on the KITCHEN light?")?.tool ===
				"HassTurnOn",
	)
	rememberJudgeVerdict(domia, scope, "I had a lovely day", {
		tool: null,
		failed: false,
	})
	checker.check(
		"a none verdict is cached as conversation",
		lookupJudgeCache(scope, "I had a lovely day")?.tool === null,
	)
	rememberJudgeVerdict(domia, scope, "Lock the door", {
		tool: null,
		failed: true,
	})
	checker.check(
		"a failed judge is never cached",
		lookupJudgeCache(scope, "Lock the door") === null,
	)

	console.log("\nthe scope follows the catalog and the model")
	const grown = judgeCacheScope(domia, requestFor(MORE_TOOLS))
	checker.check(
		"a changed catalog is a different scope",
		grown !== scope &&
			lookupJudgeCache(grown, "Turn on the kitchen light") === null,
	)
	const otherModel = judgeCacheScope(
		domiaWith({
			llmModelConfig: { ...BASE_LLM, intentModelName: "qwen3.5:4b" },
		}),
		requestFor(TOOLS),
	)
	checker.check(
		"a different judge model is a different scope",
		otherModel !== scope,
	)
	const otherKey = judgeCacheScope(
		domiaWith({ domiaKey: "DOMIA_OTHER" }),
		requestFor(TOOLS),
	)
	checker.check("another identity never shares entries", otherKey !== scope)

	console.log("\ncapacity and switches")
	const small = domiaWith({
		llmModelConfig: { ...BASE_LLM, intentCacheSize: 2 },
	})
	const smallScope = judgeCacheScope(small, requestFor(TOOLS))
	resetIntentCache()
	for (const text of ["one", "two", "three"])
		rememberJudgeVerdict(small, smallScope, text, { tool: null, failed: false })
	checker.check(
		"the oldest entry is evicted at capacity",
		lookupJudgeCache(smallScope, "one") === null &&
			lookupJudgeCache(smallScope, "three")?.tool === null &&
			intentCacheStats().entries === 2,
	)
	checker.check(
		"the cache switch is read from the config",
		isIntentCacheEnabled(domia) &&
			!isIntentCacheEnabled(
				domiaWith({
					llmModelConfig: { ...BASE_LLM, intentCacheEnabled: false },
				}),
			),
	)
	const stats = intentCacheStats()
	checker.check(
		"hits and misses are counted",
		stats.hits >= 1 && stats.misses >= 1,
		JSON.stringify(stats),
	)

	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} intent-cache checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

run()

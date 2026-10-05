import { type DomiaType } from "@/modules/core"
import {
	DEFAULT_INTENT_CACHE_ENABLED,
	DEFAULT_INTENT_CACHE_SIZE,
	DEFAULT_INTENT_MODEL,
} from "@/db"
import type { LlmChoiceRequestType } from "@/modules/llm-engine"
import type {
	IntentCacheEntryType,
	IntentCacheStatsType,
	ToolJudgeVerdictType,
} from "../types"

const judgeCache = new Map<string, IntentCacheEntryType>()
let judgeCacheHits = 0
let judgeCacheMisses = 0

const fnv1a = (value: string): string => {
	let hash = 0x811c9dc5
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash.toString(16)
}

export const normalizeIntentTranscript = (transcript: string): string =>
	transcript
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim()

export const judgeCacheScope = (
	domia: DomiaType,
	request: LlmChoiceRequestType,
): string =>
	`${domia.domiaKey}|${domia.llmModelConfig?.intentModelName?.trim() || DEFAULT_INTENT_MODEL}|${fnv1a(request.system)}`

export const isIntentCacheEnabled = (domia: DomiaType): boolean =>
	domia.llmModelConfig?.intentCacheEnabled ?? DEFAULT_INTENT_CACHE_ENABLED

const intentCacheCapacity = (domia: DomiaType): number =>
	Math.max(
		1,
		domia.llmModelConfig?.intentCacheSize ?? DEFAULT_INTENT_CACHE_SIZE,
	)

const keyOf = (scope: string, transcript: string): string =>
	`${scope}|${normalizeIntentTranscript(transcript)}`

export const lookupJudgeCache = (
	scope: string,
	transcript: string,
): ToolJudgeVerdictType | null => {
	const key = keyOf(scope, transcript)
	const entry = judgeCache.get(key)
	if (!entry) {
		judgeCacheMisses++
		return null
	}
	judgeCache.delete(key)
	judgeCache.set(key, entry)
	judgeCacheHits++
	return { tool: entry.tool, failed: false }
}

export const rememberJudgeVerdict = (
	domia: DomiaType,
	scope: string,
	transcript: string,
	verdict: ToolJudgeVerdictType,
): void => {
	if (verdict.failed) return
	const key = keyOf(scope, transcript)
	judgeCache.delete(key)
	judgeCache.set(key, { scope, tool: verdict.tool })
	const capacity = intentCacheCapacity(domia)
	while (judgeCache.size > capacity) {
		const oldest = judgeCache.keys().next().value
		if (oldest === undefined) break
		judgeCache.delete(oldest)
	}
}

export const intentCacheStats = (): IntentCacheStatsType => ({
	entries: judgeCache.size,
	hits: judgeCacheHits,
	misses: judgeCacheMisses,
})

export const resetIntentCache = (): void => {
	judgeCache.clear()
	judgeCacheHits = 0
	judgeCacheMisses = 0
}

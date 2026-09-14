import { type DomiaType } from "@/modules/core"
import { embed, embedSpaceKey } from "@/modules/embeddings"
import { getConnectionsFor } from "@/modules/skill-engine"
import { getMatcherEngine } from "@/modules/matcher"
import { intentRouterLogger, languageSetsFor } from "@/utils"
import {
	type SkillToolType,
	DEFAULT_INTENT_CACHE_ENABLED,
	DEFAULT_INTENT_CACHE_SIZE,
	DEFAULT_INTENT_CACHE_MIN_SIMILARITY,
} from "@/db"
import type {
	IntentToolHintType,
	IntentDecisionType,
	IntentCacheEntryType,
	IntentCacheStatsType,
	IntentRoutingHintsType,
} from "../types"

const embedCache = new Map<string, number[][]>()

export const cosine = (a: number[], b: number[]): number => {
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb)
	return denom === 0 ? 0 : dot / denom
}

const toolText = (t: IntentToolHintType): string =>
	t.description ? `${t.name}: ${t.description}` : t.name

export const toolEmbeddings = async (
	domia: DomiaType,
	tools: IntentToolHintType[],
): Promise<number[][] | null> => {
	const key = `${embedSpaceKey(domia)}|${tools.map(toolText).join("§")}`
	const cached = embedCache.get(key)
	if (cached) return cached
	const vectors = await embed(
		domia,
		tools.map((t) => toolText(t)),
	)
	if (!vectors) return null
	if (embedCache.size > 32) embedCache.clear()
	embedCache.set(key, vectors)
	intentRouterLogger.info(`intent tool embeddings cached (${tools.length})`, {
		domiaId: domia.id,
	})
	return vectors
}

export const exampleEmbeddings = async (
	domia: DomiaType,
	utterances: string[],
): Promise<number[][] | null> => {
	if (utterances.length === 0) return null
	const key = `ex|${embedSpaceKey(domia)}|${utterances.join("§")}`
	const cached = embedCache.get(key)
	if (cached) return cached
	const vectors = await embed(domia, utterances)
	if (!vectors) return null
	if (embedCache.size > 32) embedCache.clear()
	embedCache.set(key, vectors)
	return vectors
}

export const keywordHit = (
	transcript: string,
	keywords: string[],
): string | null => {
	const t = transcript.toLowerCase()
	for (const kw of keywords) {
		const w = kw.trim().toLowerCase()
		if (
			w.length >= KEYPHRASE_MIN_LEN &&
			new RegExp(`\\b${escapeRegExp(w)}`).test(t)
		)
			return kw
	}
	return null
}

export const hasReadTool = (
	domiaId: string,
	tools: IntentToolHintType[],
): boolean => {
	const offered = new Set(tools.map((t) => t.name))
	return getConnectionsFor(domiaId).some((conn) =>
		[...conn.toolMeta.values()].some(
			(meta) => meta.riskClass === "read" && offered.has(meta.rawName),
		),
	)
}

export const lexicalToolScore = async (
	domia: DomiaType,
	transcript: string,
	tools: IntentToolHintType[],
): Promise<number> => {
	const lexical = getMatcherEngine("lexical")
	if (!lexical || tools.length === 0) return 0
	const shaped: SkillToolType[] = tools.map((t) => ({
		provider: "",
		rawName: t.name,
		namespacedName: t.name,
		description: t.description,
		inputSchema: {},
	}))
	const ranked = await lexical.rank(transcript, shaped, {
		stopwords: languageSetsFor(domia.characterProfile?.language).stopwords,
	})
	return ranked.length > 0 ? ranked[0].score : 0
}

const KEYPHRASE_MIN_LEN = 4

const escapeRegExp = (s: string): string =>
	s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const splitClauses = (
	transcript: string,
	language: string | null | undefined,
): string[] => {
	const { conjunctions } = languageSetsFor(language)
	const re = new RegExp(
		`[,;]|\\b(?:${conjunctions.map(escapeRegExp).join("|")})\\b`,
		"i",
	)
	return transcript
		.split(re)
		.map((c) => c.trim())
		.filter((c) => c.length > 0)
}

export const keyphraseHit = (
	transcript: string,
	tools: IntentToolHintType[],
): string | null => {
	const t = transcript.toLowerCase()
	for (const tool of tools) {
		const words = tool.name
			.toLowerCase()
			.split(/[_\-.\s]+/)
			.filter((w) => w.length >= KEYPHRASE_MIN_LEN)
		if (
			words.length > 0 &&
			words.every((w) => new RegExp(`\\b${escapeRegExp(w)}`).test(t))
		)
			return tool.name
	}
	return null
}

const intentCache = new Map<string, IntentCacheEntryType>()
let intentCacheExactHits = 0
let intentCacheSemanticHits = 0
let intentCacheMisses = 0

const UNCACHEABLE_REASONS = new Set<string>(["classify-failed", "no-local-llm"])

const fnv1a = (value: string): string => {
	let hash = 0x811c9dc5
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash.toString(16)
}

export const intentToolSetHash = (tools: IntentToolHintType[]): string =>
	fnv1a(
		tools
			.map((t) => `${t.name}\u0000${t.description ?? ""}`)
			.sort()
			.join("\u0001"),
	)

const routingConfigHash = (
	domia: DomiaType,
	hints: IntentRoutingHintsType | undefined,
): string => {
	const llm = domia.llmModelConfig
	return fnv1a(
		[
			domia.characterProfile?.language ?? "",
			llm?.intentLexicalMinScore ?? "",
			(hints?.keywords ?? []).join("\u0001"),
			(hints?.exampleUtterances ?? []).join("\u0001"),
			llm?.skillsRouting ?? "",
			llm?.intentEmbedThreshold ?? "",
			llm?.descriptorRoutingEnabled ?? "",
			llm?.intentModelName ?? "",
			llm?.intentLlmOnSingleSlot ?? "",
			llm?.intentCacheMinSimilarity ?? "",
		].join("|"),
	)
}

export const normalizeIntentTranscript = (transcript: string): string =>
	transcript
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim()

export const intentCacheScope = (
	domia: DomiaType,
	tools: IntentToolHintType[],
	hints?: IntentRoutingHintsType,
): string =>
	`${domia.domiaKey}|${routingConfigHash(domia, hints)}|${embedSpaceKey(domia)}|${intentToolSetHash(tools)}`

export const isIntentCacheEnabled = (domia: DomiaType): boolean =>
	domia.llmModelConfig?.intentCacheEnabled ?? DEFAULT_INTENT_CACHE_ENABLED

const intentCacheCapacity = (domia: DomiaType): number =>
	Math.max(
		1,
		domia.llmModelConfig?.intentCacheSize ?? DEFAULT_INTENT_CACHE_SIZE,
	)

const intentCacheMinSimilarity = (domia: DomiaType): number =>
	domia.llmModelConfig?.intentCacheMinSimilarity ??
	DEFAULT_INTENT_CACHE_MIN_SIMILARITY

const touch = (key: string, entry: IntentCacheEntryType): void => {
	intentCache.delete(key)
	intentCache.set(key, entry)
}

const decisionOf = (
	entry: IntentCacheEntryType,
	similarity: number,
): IntentDecisionType => ({
	needsSkill: entry.needsSkill,
	reason: `cache:${similarity.toFixed(2)}`,
})

export const lookupIntentCacheExact = (
	scope: string,
	transcript: string,
): IntentDecisionType | null => {
	const key = `${scope}|${normalizeIntentTranscript(transcript)}`
	const entry = intentCache.get(key)
	if (!entry) return null
	touch(key, entry)
	intentCacheExactHits++
	return decisionOf(entry, 1)
}

export const lookupIntentCacheSemantic = (
	domia: DomiaType,
	scope: string,
	vector: number[],
): IntentDecisionType | null => {
	const threshold = intentCacheMinSimilarity(domia)
	let bestKey: string | null = null
	let bestEntry: IntentCacheEntryType | null = null
	let best = threshold
	for (const [key, entry] of intentCache) {
		if (entry.scope !== scope || !entry.vector) continue
		const similarity = cosine(vector, entry.vector)
		if (similarity < best) continue
		best = similarity
		bestKey = key
		bestEntry = entry
	}
	if (!bestKey || !bestEntry) return null
	touch(bestKey, bestEntry)
	intentCacheSemanticHits++
	intentRouterLogger.info(
		`intent cache semantic hit sim=${best.toFixed(3)} thr=${threshold}`,
		{ domiaId: domia.id },
	)
	return decisionOf(bestEntry, best)
}

export const rememberIntentDecision = (
	domia: DomiaType,
	scope: string,
	transcript: string,
	vector: number[] | null,
	decision: IntentDecisionType,
): void => {
	if (
		UNCACHEABLE_REASONS.has(decision.reason) ||
		decision.reason.startsWith("cache:")
	)
		return
	const key = `${scope}|${normalizeIntentTranscript(transcript)}`
	intentCache.delete(key)
	intentCache.set(key, { scope, vector, needsSkill: decision.needsSkill })
	const capacity = intentCacheCapacity(domia)
	while (intentCache.size > capacity) {
		const oldest = intentCache.keys().next().value
		if (oldest === undefined) break
		intentCache.delete(oldest)
	}
}

export const noteIntentCacheMiss = (): void => {
	intentCacheMisses++
}

export const intentCacheStats = (): IntentCacheStatsType => ({
	entries: intentCache.size,
	exactHits: intentCacheExactHits,
	semanticHits: intentCacheSemanticHits,
	misses: intentCacheMisses,
})

export const resetIntentCache = (): void => {
	intentCache.clear()
	intentCacheExactHits = 0
	intentCacheSemanticHits = 0
	intentCacheMisses = 0
}

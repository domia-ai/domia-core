import {
	SKILLS_ROUTING_ENUM,
	DEFAULT_INTENT_MODEL,
	DEFAULT_INTENT_EMBED_THRESHOLD,
	DEFAULT_INTENT_LEXICAL_MIN_SCORE,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { runLLMIntent } from "@/modules/llm-engine"
import { knownSlotCount } from "@/modules/llm-slots"
import { intentRouterLogger, parseLlmJson, languageSetsFor } from "@/utils"

import { INTENT_SYSTEM } from "../constants"
import { embed } from "@/modules/embeddings"
import {
	cosine,
	keyphraseHit,
	keywordHit,
	exampleEmbeddings,
	toolEmbeddings,
	lexicalToolScore,
	splitClauses,
	hasReadTool,
	intentCacheScope,
	isIntentCacheEnabled,
	lookupIntentCacheExact,
	lookupIntentCacheSemantic,
	noteIntentCacheMiss,
	rememberIntentDecision,
} from "../utils"
import type {
	IntentDecisionType,
	IntentToolHintType,
	IntentRoutingHintsType,
	IntentEmbeddingOutcomeType,
} from "../types"

const EMBED_AMBIGUITY_BAND = 0.06

const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const routingBlockerHit = (
	transcript: string,
	language: string | null | undefined,
): string | null => {
	const folded = transcript.toLowerCase()
	for (const blocker of languageSetsFor(language ?? null).routingBlockers) {
		const re = new RegExp(
			`(^|[\\s,;¡¿"'(])${escapeRe(blocker)}([\\s,;.!?"')]|$)`,
			"i",
		)
		if (re.test(folded)) return blocker
	}
	return null
}

const foldMarker = (v: string): string =>
	v.toLowerCase().replace(/[‘’ʼ]/g, "'").normalize("NFD").replace(/\p{M}/gu, "")

const markerHit = (transcript: string, markers: string[]): string | null => {
	const folded = foldMarker(transcript)
	for (const marker of markers)
		if (folded.includes(foldMarker(marker))) return marker
	return null
}

export const personalQuestionHit = (
	transcript: string,
	language: string | null | undefined,
): string | null =>
	markerHit(
		transcript,
		languageSetsFor(language ?? null).personalQuestionMarkers,
	)

const EDGE_PUNCTUATION_RE = /^[\s¿¡"']+|[\s?!.,"']+$/g

const structuralStateQuestion = (
	transcript: string,
	openers: string[],
	stateWords: string[],
): string | null => {
	const folded = foldMarker(transcript).replace(EDGE_PUNCTUATION_RE, "")
	const opener = openers.find((o) => folded.startsWith(`${foldMarker(o)} `))
	if (!opener) return null
	const word = stateWords.find((w) => folded.endsWith(` ${foldMarker(w)}`))
	return word ? `${opener} … ${word}` : null
}

export const stateQuestionHit = (
	transcript: string,
	language: string | null | undefined,
): string | null => {
	const sets = languageSetsFor(language ?? null)
	return (
		markerHit(transcript, sets.stateQuestionMarkers) ??
		structuralStateQuestion(
			transcript,
			sets.stateQuestionOpeners,
			sets.stateWords,
		)
	)
}

export const retryCueHit = (
	transcript: string,
	language: string | null | undefined,
): string | null =>
	markerHit(transcript, languageSetsFor(language ?? null).retryCues)

export const scoreIntentEmbedding = async (
	domia: DomiaType,
	transcript: string,
	tools: IntentToolHintType[],
	hints?: IntentRoutingHintsType,
): Promise<{ best: number; lexical: number } | null> => {
	const [toolVecs, exampleVecs, queryVecs] = await Promise.all([
		toolEmbeddings(domia, tools),
		hints?.exampleUtterances?.length
			? exampleEmbeddings(domia, hints.exampleUtterances)
			: Promise.resolve(null),
		embed(domia, [transcript]),
	])
	const query = queryVecs?.[0]
	if (!toolVecs || !query) return null
	let best = 0
	for (const vec of toolVecs) best = Math.max(best, cosine(query, vec))
	if (exampleVecs)
		for (const vec of exampleVecs) best = Math.max(best, cosine(query, vec))
	const lexical = await lexicalToolScore(domia, transcript, tools)
	return { best, lexical }
}

const numericFollowUp = (
	transcript: string,
	language: string | null | undefined,
): boolean => {
	const sets = languageSetsFor(language)
	const tokens = transcript
		.toLowerCase()
		.replace(/[.,!?¡¿%]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
	if (tokens.length === 0 || tokens.length > 4) return false
	let hasNumber = false
	for (const token of tokens) {
		if (/^\d+$/.test(token) || token in sets.numberWords) {
			hasNumber = true
			continue
		}
		if (sets.numberJoiners.includes(token)) continue
		if (sets.percentWords.includes(token)) continue
		return false
	}
	return hasNumber
}

const someClauseNeedsTools = async (
	domia: DomiaType,
	transcript: string,
	toolVecs: number[][],
	exampleVecs: number[][] | null,
): Promise<boolean> => {
	const language = domia.characterProfile?.language
	const clauses = splitClauses(transcript, language).filter(
		(clause) => personalQuestionHit(clause, language) === null,
	)
	if (clauses.length === 0) return false
	const vectors = await embed(domia, clauses)
	if (!vectors) return false
	const reference = exampleVecs ? [...toolVecs, ...exampleVecs] : toolVecs
	return vectors.some((query) =>
		reference.some(
			(vec) => cosine(query, vec) >= DEFAULT_INTENT_EMBED_THRESHOLD,
		),
	)
}

const classifyByEmbedding = async (
	domia: DomiaType,
	transcript: string,
	tools: IntentToolHintType[],
	scope: string | null,
	hints?: IntentRoutingHintsType,
): Promise<IntentEmbeddingOutcomeType> => {
	const language = domia.characterProfile?.language
	const lexicalOnly = (
		outcome: IntentDecisionType,
	): IntentEmbeddingOutcomeType => ({ outcome, vector: null })
	const hit = keyphraseHit(transcript, tools)
	if (hit) return lexicalOnly({ needsSkill: true, reason: `keyphrase:${hit}` })
	if (numericFollowUp(transcript, language))
		return lexicalOnly({ needsSkill: true, reason: "numeric-followup" })
	const retry = retryCueHit(transcript, language)
	if (retry) return lexicalOnly({ needsSkill: true, reason: `retry:${retry}` })
	if (personalQuestionHit(transcript, language) === null) {
		const stateQuestion = stateQuestionHit(transcript, language)
		if (stateQuestion && hasReadTool(domia.id, tools))
			return lexicalOnly({
				needsSkill: true,
				reason: `state-question:${stateQuestion}`,
			})
	}
	if (hints?.keywords?.length) {
		const kw = keywordHit(transcript, hints.keywords)
		if (kw) return lexicalOnly({ needsSkill: true, reason: `keyword:${kw}` })
	}
	const started = Date.now()
	const [toolVecs, exampleVecs, queryVecs] = await Promise.all([
		toolEmbeddings(domia, tools),
		hints?.exampleUtterances?.length
			? exampleEmbeddings(domia, hints.exampleUtterances)
			: Promise.resolve(null),
		embed(domia, [transcript]),
	])
	const query = queryVecs?.[0]
	if (!toolVecs || !query) return { outcome: null, vector: null }
	if (scope) {
		const cached = lookupIntentCacheSemantic(domia, scope, query)
		if (cached) return { outcome: cached, vector: query }
	}
	let best = 0
	for (const vec of toolVecs) best = Math.max(best, cosine(query, vec))
	if (exampleVecs)
		for (const vec of exampleVecs) best = Math.max(best, cosine(query, vec))
	const threshold =
		domia.llmModelConfig?.intentEmbedThreshold ?? DEFAULT_INTENT_EMBED_THRESHOLD
	let verdict =
		best >= threshold
			? "skill"
			: best >= threshold - EMBED_AMBIGUITY_BAND
				? "ambiguous"
				: "chat"
	const lexicalMin =
		domia.llmModelConfig?.intentLexicalMinScore ??
		DEFAULT_INTENT_LEXICAL_MIN_SCORE
	let lexical = 0
	if (verdict === "chat") {
		lexical = await lexicalToolScore(domia, transcript, tools)
		if (lexical > 0 && lexical >= lexicalMin) verdict = "ambiguous"
	}
	if (verdict === "skill") {
		const blocker = routingBlockerHit(
			transcript,
			domia.characterProfile?.language,
		)
		if (blocker) verdict = "ambiguous"
	}
	const marker =
		verdict !== "chat" && best < DEFAULT_INTENT_EMBED_THRESHOLD
			? personalQuestionHit(transcript, domia.characterProfile?.language)
			: null
	const personal =
		marker &&
		!(await someClauseNeedsTools(domia, transcript, toolVecs, exampleVecs))
			? marker
			: null
	if (personal) verdict = "chat"
	intentRouterLogger.info(
		`intent embedding gate: sim=${best.toFixed(3)} lex=${lexical.toFixed(2)} thr=${threshold} lexMin=${lexicalMin}${personal ? ` personal="${personal}"` : ""} → ${verdict} (${Date.now() - started}ms)`,
		{ domiaId: domia.id },
	)
	if (verdict === "ambiguous") return { outcome: "ambiguous", vector: query }
	if (personal)
		return {
			outcome: { needsSkill: false, reason: `personal:${personal}` },
			vector: query,
		}
	return {
		outcome: {
			needsSkill: verdict === "skill",
			reason: `embedding:${best.toFixed(2)}`,
		},
		vector: query,
	}
}

const buildPrompt = (
	transcript: string,
	tools: IntentToolHintType[],
): string => {
	const seen = new Set<string>()
	const lines: string[] = []
	for (const t of tools) {
		if (seen.has(t.name)) continue
		seen.add(t.name)
		lines.push(t.description ? `- ${t.name}: ${t.description}` : `- ${t.name}`)
	}
	return `${INTENT_SYSTEM}\n\nAvailable tools:\n${lines.join("\n")}\n\nUser: ${transcript}\nJSON:`
}

const parseDecision = (raw: string): boolean | null => {
	const { value: obj } = parseLlmJson(raw)
	if (obj) {
		const v = obj.tool ?? obj.needsTool ?? obj.needs_skill ?? obj.skill
		if (typeof v === "boolean") return v
		if (typeof v === "string") {
			const s = v.trim().toLowerCase()
			if (["false", "no", "none", "null", ""].includes(s)) return false
			return true
		}
	}
	if (/\btrue\b/i.test(raw) && !/\bfalse\b/i.test(raw)) return true
	if (/\bfalse\b/i.test(raw) && !/\btrue\b/i.test(raw)) return false
	return null
}

export const classifyNeedsSkill = async (
	domia: DomiaType,
	transcript: string,
	tools: IntentToolHintType[],
	opts: { canRunLlm: boolean; hints?: IntentRoutingHintsType },
): Promise<IntentDecisionType> => {
	const routing = domia.llmModelConfig?.skillsRouting
	if (routing === SKILLS_ROUTING_ENUM.ALWAYS_AGENT)
		return { needsSkill: true, reason: "always-agent" }
	if (routing === SKILLS_ROUTING_ENUM.FAST_ROUTER)
		return { needsSkill: tools.length > 0, reason: "fast-router" }
	const scope = isIntentCacheEnabled(domia)
		? intentCacheScope(domia, tools, opts.hints)
		: null
	if (scope) {
		const exact = lookupIntentCacheExact(scope, transcript)
		if (exact) return exact
		noteIntentCacheMiss()
	}
	const remember = (
		decision: IntentDecisionType,
		vector: number[] | null,
	): IntentDecisionType => {
		if (scope)
			rememberIntentDecision(domia, scope, transcript, vector, decision)
		return decision
	}
	let queryVector: number[] | null = null
	if (routing === SKILLS_ROUTING_ENUM.EMBEDDING_GATE) {
		const { outcome, vector } = await classifyByEmbedding(
			domia,
			transcript,
			tools,
			scope,
			opts.hints,
		)
		queryVector = vector
		if (outcome && outcome !== "ambiguous") return remember(outcome, vector)
		if (outcome === null) {
			intentRouterLogger.warn(
				"embedding gate unavailable — falling back to LLM classifier",
				{ domiaId: domia.id },
			)
		}
	}
	if (!opts.canRunLlm) return { needsSkill: false, reason: "no-local-llm" }
	if (
		domia.llmModelConfig?.intentLlmOnSingleSlot === false &&
		knownSlotCount(domia) === 1
	)
		return { needsSkill: tools.length > 0, reason: "single-slot-skip-llm" }

	const model =
		domia.llmModelConfig?.intentModelName?.trim() || DEFAULT_INTENT_MODEL
	try {
		const raw = await runLLMIntent(domia, buildPrompt(transcript, tools), model)
		const decided = raw == null ? null : parseDecision(raw)
		if (decided == null) {
			intentRouterLogger.warn("intent unparseable — failing closed to chat", {
				domiaId: domia.id,
				raw,
			})
			return { needsSkill: false, reason: "classify-failed" }
		}
		return remember({ needsSkill: decided, reason: "classified" }, queryVector)
	} catch (error) {
		intentRouterLogger.warn("intent classify failed — failing closed to chat", {
			domiaId: domia.id,
			error,
		})
		return { needsSkill: false, reason: "classify-failed" }
	}
}

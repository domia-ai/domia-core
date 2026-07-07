import {
	SKILLS_ROUTING_ENUM,
	DEFAULT_INTENT_MODEL,
	DEFAULT_INTENT_EMBED_THRESHOLD,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { runLLMIntent } from "@/modules/llm-engine"
import { intentRouterLogger, parseLlmJson } from "@/utils"

import { INTENT_SYSTEM } from "../constants"
import { embed } from "@/modules/embeddings"
import {
	cosine,
	keyphraseHit,
	keywordHit,
	exampleEmbeddings,
	toolEmbeddings,
	lexicalToolScore,
} from "../utils"
import type {
	IntentDecisionType,
	IntentToolHintType,
	IntentRoutingHintsType,
} from "../types"

const EMBED_AMBIGUITY_BAND = 0.06

const classifyByEmbedding = async (
	domia: DomiaType,
	transcript: string,
	tools: IntentToolHintType[],
	hints?: IntentRoutingHintsType,
): Promise<IntentDecisionType | "ambiguous" | null> => {
	const hit = keyphraseHit(transcript, tools)
	if (hit) return { needsSkill: true, reason: `keyphrase:${hit}` }
	if (hints?.keywords?.length) {
		const kw = keywordHit(transcript, hints.keywords)
		if (kw) return { needsSkill: true, reason: `keyword:${kw}` }
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
	if (!toolVecs || !query) return null
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
	let lexical = 0
	if (verdict === "chat") {
		lexical = await lexicalToolScore(domia, transcript, tools)
		if (lexical > 0) verdict = "ambiguous"
	}
	intentRouterLogger.info(
		`intent embedding gate: sim=${best.toFixed(3)} lex=${lexical.toFixed(2)} thr=${threshold} → ${verdict} (${Date.now() - started}ms)`,
		{ domiaId: domia.id },
	)
	if (verdict === "ambiguous") return "ambiguous"
	return {
		needsSkill: verdict === "skill",
		reason: `embedding:${best.toFixed(2)}`,
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
	if (routing === SKILLS_ROUTING_ENUM.EMBEDDING_GATE) {
		const decided = await classifyByEmbedding(
			domia,
			transcript,
			tools,
			opts.hints,
		)
		if (decided && decided !== "ambiguous") return decided
		if (decided === null) {
			intentRouterLogger.warn(
				"embedding gate unavailable — falling back to LLM classifier",
				{ domiaId: domia.id },
			)
		}
	}
	if (!opts.canRunLlm) return { needsSkill: true, reason: "no-local-llm" }

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
		return { needsSkill: decided, reason: "classified" }
	} catch (error) {
		intentRouterLogger.warn("intent classify failed — failing closed to chat", {
			domiaId: domia.id,
			error,
		})
		return { needsSkill: false, reason: "classify-failed" }
	}
}

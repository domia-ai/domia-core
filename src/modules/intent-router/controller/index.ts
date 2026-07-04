import {
	SKILLS_ROUTING_ENUM,
	DEFAULT_INTENT_MODEL,
	DEFAULT_INTENT_EMBED_THRESHOLD,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { runLLMIntent } from "@/modules/llm-engine"
import { intentRouterLogger } from "@/utils"

import { INTENT_SYSTEM } from "../constants"
import { cosine, embedTexts, keyphraseHit, toolEmbeddings } from "../utils"
import type { IntentDecisionType, IntentToolHintType } from "../types"

const EMBED_AMBIGUITY_BAND = 0.06

const classifyByEmbedding = async (
	domia: DomiaType,
	transcript: string,
	tools: IntentToolHintType[],
): Promise<IntentDecisionType | "ambiguous" | null> => {
	const hit = keyphraseHit(transcript, tools)
	if (hit) return { needsSkill: true, reason: `keyphrase:${hit}` }
	const started = Date.now()
	const [toolVecs, queryVecs] = await Promise.all([
		toolEmbeddings(domia, tools),
		embedTexts(domia, [transcript]),
	])
	const query = queryVecs?.[0]
	if (!toolVecs || !query) return null
	let best = 0
	for (const vec of toolVecs) best = Math.max(best, cosine(query, vec))
	const threshold =
		domia.llmModelConfig?.intentEmbedThreshold ?? DEFAULT_INTENT_EMBED_THRESHOLD
	const verdict =
		best >= threshold
			? "skill"
			: best >= threshold - EMBED_AMBIGUITY_BAND
				? "ambiguous"
				: "chat"
	intentRouterLogger.info(
		`intent embedding gate: sim=${best.toFixed(3)} thr=${threshold} → ${verdict} (${Date.now() - started}ms)`,
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
	try {
		const obj = JSON.parse(raw) as Record<string, unknown>
		const v = obj.tool ?? obj.needsTool ?? obj.needs_skill ?? obj.skill
		if (typeof v === "boolean") return v
		if (typeof v === "string") {
			const s = v.trim().toLowerCase()
			if (["false", "no", "none", "null", ""].includes(s)) return false
			return true
		}
	} catch {
		/* fall through */
	}
	if (/\btrue\b/i.test(raw) && !/\bfalse\b/i.test(raw)) return true
	if (/\bfalse\b/i.test(raw) && !/\btrue\b/i.test(raw)) return false
	return null
}

export const classifyNeedsSkill = async (
	domia: DomiaType,
	transcript: string,
	tools: IntentToolHintType[],
	opts: { canRunLlm: boolean },
): Promise<IntentDecisionType> => {
	const routing = domia.llmModelConfig?.skillsRouting
	if (routing === SKILLS_ROUTING_ENUM.ALWAYS_AGENT)
		return { needsSkill: true, reason: "always-agent" }
	if (routing === SKILLS_ROUTING_ENUM.EMBEDDING_GATE) {
		const decided = await classifyByEmbedding(domia, transcript, tools)
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

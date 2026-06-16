import { SKILLS_ROUTING_ENUM, DEFAULT_INTENT_MODEL } from "@/db"
import type { DomiaType } from "@/modules/core"
import { runLLMIntent } from "@/modules/llm-engine"
import { intentRouterLogger } from "@/utils"

import { INTENT_SYSTEM } from "../constants"
import type { IntentDecisionType, IntentToolHintType } from "../types"

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

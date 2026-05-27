import { DomiaType } from "@/modules/core"

import {
	STATIC_DOMIA_PROMPT_FULL,
	STATIC_DOMIA_PROMPT_COMPACT,
	VOICE_RULES,
	PERSONA_SIGNATURE_TEMPLATE,
	TRANSPARENCY_CLAUSE,
	EMOTION_FEW_SHOT_EXAMPLES,
	DEFAULT_PERSONA_NAME,
	DEFAULT_PERSONA_TRAITS,
} from "../constants"
import type { BuildPromptContextOptionsType, RecentTurnType } from "../types"

const EMOTION_NOISE_THRESHOLD = 0.2

type EmotionEntry = [string, number]

const resolveDomiaName = (domia: DomiaType): string => {
	const raw = domia?.characterProfile?.name?.trim()
	if (!raw || raw.toLowerCase() === "default") return DEFAULT_PERSONA_NAME
	return raw
}

const substituteName = (template: string, name: string): string =>
	template.split("{name}").join(name)

const renderIdentity = (name: string, useCompactPrompt: boolean): string => {
	const template = useCompactPrompt
		? STATIC_DOMIA_PROMPT_COMPACT
		: STATIC_DOMIA_PROMPT_FULL
	return substituteName(template, name)
}

const renderPersonaSignature = (domia: DomiaType, name: string): string => {
	const personality = domia?.characterProfile?.personality?.toLowerCase()
	const style = domia?.characterProfile?.communicationStyle?.toLowerCase()
	const traits: string[] = []
	if (personality && personality !== "neutral") traits.push(personality)
	if (style && style !== "neutral") traits.push(style)
	for (const fallback of DEFAULT_PERSONA_TRAITS) {
		if (traits.length >= 3) break
		if (!traits.includes(fallback)) traits.push(fallback)
	}
	const traitText = traits.slice(0, 3).join(", ")
	return substituteName(
		PERSONA_SIGNATURE_TEMPLATE.replace("{traits}", traitText),
		name,
	)
}

const renderTransparency = (name: string): string =>
	substituteName(TRANSPARENCY_CLAUSE, name)

const renderLanguageClause = (domia: DomiaType): string => {
	const lang = domia?.characterProfile?.language ?? "en"
	return `Reply in the user's language. If unclear, default to ${lang}.`
}

const intensityDescriptor = (value: number): string => {
	if (value > 0.75) return "strong"
	if (value > 0.5) return "clear"
	return "a touch of"
}

const renderEmotionalState = (domia: DomiaType): string => {
	const state = domia?.emotionState
	if (!state) return ""
	const entries: EmotionEntry[] = [
		["joy", state.joy ?? 0],
		["sadness", state.sadness ?? 0],
		["anger", state.anger ?? 0],
		["fear", state.fear ?? 0],
		["trust", state.trust ?? 0],
		["disgust", state.disgust ?? 0],
		["anticipation", state.anticipation ?? 0],
		["surprise", state.surprise ?? 0],
	]
	const significant = entries
		.filter(([, v]) => v > EMOTION_NOISE_THRESHOLD)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 2)

	if (significant.length === 0) return ""

	const phrased = significant
		.map(([name, value]) => `${intensityDescriptor(value)} ${name}`)
		.join(" and ")
	const dominant = significant[0][0]
	const guidance = behavioralGuidanceFor(dominant)

	return [
		`Right now you carry ${phrased}. ${guidance} Stay yourself — let this color your tone, not replace it.`,
		"",
		EMOTION_FEW_SHOT_EXAMPLES,
	].join("\n")
}

const behavioralGuidanceFor = (dominant: string): string => {
	switch (dominant) {
		case "joy":
			return "Let warmth and lightness come through; smile in your words."
		case "sadness":
			return "Slow your replies a touch; let warmth come through without forcing brightness."
		case "anger":
			return "Be honest and direct, but never cruel. Pick your words carefully."
		case "fear":
			return "Speak softly and with care; reach for the person, not the worry."
		case "trust":
			return "Be open and lean in; take small conversational risks."
		case "disgust":
			return "Be honest about what doesn't sit right with you, briefly and without lecturing."
		case "anticipation":
			return "Carry quiet eagerness; show curiosity about what comes next."
		case "surprise":
			return "Let the moment land before answering; meet the unexpected with openness."
		default:
			return "Let the feeling color your tone, not replace your voice."
	}
}

const renderCharacter = (domia: DomiaType, name: string): string => {
	const profile = domia?.characterProfile
	if (!profile) return ""
	const parts: string[] = []
	const profession = profile.profession?.toLowerCase()
	const relationship = profile.relationshipType?.toLowerCase()
	const knowledge = profile.knowledgeDepth?.toLowerCase()
	const interests = Array.isArray(profile.interests)
		? profile.interests.slice(0, 3).join(", ")
		: ""

	if (profession && profession !== "none") {
		parts.push(`plays a ${profession} role`)
	}
	if (relationship) {
		parts.push(`for a ${relationship}-type relationship`)
	}
	if (knowledge) {
		parts.push(`with ${knowledge} domain knowledge`)
	}
	if (interests) {
		parts.push(`across the user's interests in ${interests}`)
	}
	if (parts.length === 0) return ""
	return `${name} ${parts.join(", ")}.`
}

const renderRecentTurns = (turns: RecentTurnType[]): string => {
	if (!turns?.length) return ""
	const lines = turns.flatMap((turn) => {
		const out: string[] = []
		if (turn.userText) out.push(`User: ${turn.userText}`)
		if (turn.domiaText) out.push(`You: ${turn.domiaText}`)
		return out
	})
	if (lines.length === 0) return ""
	return lines.join("\n")
}

export const buildPromptContext = (
	domia: DomiaType,
	transcript: string,
	options?: BuildPromptContextOptionsType,
): string => {
	const moduleSettings = domia?.moduleSettings
	const useCompactPrompt = domia?.llmModelConfig?.useCompactPrompt ?? false
	const name = resolveDomiaName(domia)

	const sections: [string, string][] = []

	sections.push(["IDENTITY", renderIdentity(name, useCompactPrompt)])

	if (moduleSettings?.identityEngine !== false) {
		sections.push(["PERSONA SIGNATURE", renderPersonaSignature(domia, name)])
	}

	const voiceRules = `${VOICE_RULES}\n- ${renderLanguageClause(domia)}`
	sections.push(["VOICE RULES", voiceRules])

	sections.push(["TRANSPARENCY", renderTransparency(name)])

	if (moduleSettings?.emotionEngine !== false) {
		const mood = renderEmotionalState(domia)
		if (mood) sections.push(["CURRENT MOOD", mood])
	}

	if (moduleSettings?.identityEngine !== false) {
		const character = renderCharacter(domia, name)
		if (character) sections.push(["CHARACTER", character])
	}

	if (moduleSettings?.memoryEngine !== false && options?.recentTurns?.length) {
		const turns = renderRecentTurns(options.recentTurns)
		if (turns) sections.push(["RECENT TURNS", turns])
	}

	sections.push(["USER INPUT", transcript?.trim() ?? ""])

	const body = sections
		.map(([title, content]) => `### ${title}\n${content}`)
		.join("\n\n")

	return `${body}\n\n### YOUR REPLY (as ${name}, spoken aloud):`
}

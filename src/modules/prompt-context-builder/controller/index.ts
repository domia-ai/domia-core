import { DomiaType } from "@/modules/core"

import {
	STATIC_DOMIA_PROMPT_FULL,
	STATIC_DOMIA_PROMPT_COMPACT,
	VOICE_RULES,
	PERSONA_SIGNATURE_TEMPLATE,
	TRANSPARENCY_CLAUSE,
	DEFAULT_PERSONA_NAME,
	DEFAULT_PERSONA_TRAITS,
} from "../constants"
import type {
	BuildPromptContextOptionsType,
	PersonaContextType,
	RecentTurnType,
} from "../types"

const EMOTION_NOISE_THRESHOLD = 0.2

type EmotionEntry = [string, number]

export const personaContextFromDomia = (
	domia: DomiaType,
	recentTurns?: RecentTurnType[],
	knownFacts?: string[],
	userMoodTrend?: string[],
): PersonaContextType => {
	const cp = domia?.characterProfile
	const es = domia?.emotionState
	const ms = domia?.moduleSettings
	return {
		characterProfile: cp
			? {
					name: cp.name,
					personality: cp.personality,
					communicationStyle: cp.communicationStyle,
					profession: cp.profession,
					relationshipType: cp.relationshipType,
					knowledgeDepth: cp.knowledgeDepth,
					language: cp.language,
					interests: Array.isArray(cp.interests)
						? (cp.interests as string[])
						: null,
				}
			: null,
		emotionState: es
			? {
					joy: es.joy ?? 0,
					sadness: es.sadness ?? 0,
					anger: es.anger ?? 0,
					fear: es.fear ?? 0,
					trust: es.trust ?? 0,
					disgust: es.disgust ?? 0,
					anticipation: es.anticipation ?? 0,
					surprise: es.surprise ?? 0,
				}
			: null,
		moduleSettings: ms
			? {
					identityEngine: ms.identityEngine,
					emotionEngine: ms.emotionEngine,
					emotionCapture: ms.emotionCapture,
					memoryEngine: ms.memoryEngine,
					factCapture: ms.factCapture,
					factRecall: ms.factRecall,
				}
			: null,
		useCompactPrompt: domia?.llmModelConfig?.useCompactPrompt ?? false,
		recentTurns: recentTurns?.length ? recentTurns : null,
		knownFacts: knownFacts?.length ? knownFacts : null,
		userMoodTrend: userMoodTrend?.length ? userMoodTrend : null,
		promptOverrides:
			cp?.promptOverrides && typeof cp.promptOverrides === "object"
				? (cp.promptOverrides as PersonaContextType["promptOverrides"])
				: null,
		ttsVoice: domia?.ttsConfig
			? {
					voiceName: domia.ttsConfig.voiceName,
					speed: domia.ttsConfig.speed,
					silenceScale: domia.ttsConfig.silenceScale,
					pitch: domia.ttsConfig.pitch,
				}
			: null,
	}
}

const resolvePersonaName = (persona: PersonaContextType): string => {
	const raw = persona.characterProfile?.name?.trim()
	if (!raw || raw.toLowerCase() === "default") return DEFAULT_PERSONA_NAME
	return raw
}

const substituteName = (template: string, name: string): string =>
	template.split("{name}").join(name)

const renderIdentity = (persona: PersonaContextType, name: string): string => {
	const override = persona.promptOverrides?.identity?.trim()
	if (override) return substituteName(override, name)
	const template = persona.useCompactPrompt
		? STATIC_DOMIA_PROMPT_COMPACT
		: STATIC_DOMIA_PROMPT_FULL
	return substituteName(template, name)
}

const renderPersonaSignature = (
	persona: PersonaContextType,
	name: string,
): string => {
	const override = persona.promptOverrides?.traits
	const traits: string[] = []
	if (override?.length) {
		traits.push(...override)
	} else {
		const personality = persona.characterProfile?.personality?.toLowerCase()
		const style = persona.characterProfile?.communicationStyle?.toLowerCase()
		if (personality && personality !== "neutral") traits.push(personality)
		if (style && style !== "neutral") traits.push(style)
		for (const fallback of DEFAULT_PERSONA_TRAITS) {
			if (traits.length >= 3) break
			if (!traits.includes(fallback)) traits.push(fallback)
		}
	}
	const traitText = traits.slice(0, 3).join(", ")
	return substituteName(
		PERSONA_SIGNATURE_TEMPLATE.replace("{traits}", traitText),
		name,
	)
}

const renderTransparency = (name: string): string =>
	substituteName(TRANSPARENCY_CLAUSE, name)

const renderLanguageClause = (persona: PersonaContextType): string => {
	const lang = persona.characterProfile?.language ?? "en"
	return `Reply in the user's language. If unclear, default to ${lang}.`
}

const intensityDescriptor = (value: number): string => {
	if (value > 0.75) return "strong"
	if (value > 0.5) return "clear"
	return "a touch of"
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

const renderEmotionalState = (persona: PersonaContextType): string => {
	const state = persona.emotionState
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

	return `Right now you carry ${phrased}. ${guidance} Stay yourself — let this color your tone, not replace it.`
}

const renderCharacter = (persona: PersonaContextType, name: string): string => {
	const profile = persona.characterProfile
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

export const buildPromptFromPersona = (
	persona: PersonaContextType,
	transcript: string,
	options?: BuildPromptContextOptionsType,
): string => {
	const moduleSettings = persona.moduleSettings
	const name = resolvePersonaName(persona)

	const sections: [string, string][] = []

	sections.push(["IDENTITY", renderIdentity(persona, name)])

	if (moduleSettings?.identityEngine !== false) {
		sections.push(["PERSONA SIGNATURE", renderPersonaSignature(persona, name)])
	}

	const voiceRules = `${VOICE_RULES}\n- ${renderLanguageClause(persona)}`
	sections.push(["VOICE RULES", voiceRules])

	sections.push(["TRANSPARENCY", renderTransparency(name)])

	const styleNotes = persona.promptOverrides?.styleNotes?.trim()
	if (moduleSettings?.identityEngine !== false && styleNotes) {
		sections.push(["STYLE", styleNotes])
	}

	if (moduleSettings?.identityEngine !== false) {
		const character = renderCharacter(persona, name)
		if (character) sections.push(["CHARACTER", character])
	}

	const environmentContext = persona.promptOverrides?.environmentContext?.trim()
	if (environmentContext) {
		sections.push(["ENVIRONMENT", environmentContext])
	}

	if (moduleSettings?.emotionEngine !== false) {
		const mood = renderEmotionalState(persona)
		if (mood) sections.push(["CURRENT MOOD", mood])
	}

	const userMoodTrend = persona.userMoodTrend ?? options?.userMoodTrend
	if (moduleSettings?.emotionEngine !== false && userMoodTrend?.length) {
		sections.push([
			"RECENT USER MOOD",
			`Over recent messages the person has seemed: ${userMoodTrend.join(" → ")}. Attune to this; don't mention it mechanically.`,
		])
	}

	const knownFacts = persona.knownFacts ?? options?.knownFacts
	if (moduleSettings?.factRecall !== false && knownFacts?.length) {
		sections.push(["WHAT YOU KNOW", knownFacts.map((f) => `- ${f}`).join("\n")])
	}

	const recentTurns = persona.recentTurns ?? options?.recentTurns
	if (moduleSettings?.memoryEngine !== false && recentTurns?.length) {
		const turns = renderRecentTurns(recentTurns)
		if (turns) sections.push(["RECENT TURNS", turns])
	}

	if (!options?.omitUserInput) {
		sections.push(["USER INPUT", transcript?.trim() ?? ""])
	}

	const body = sections
		.map(([title, content]) => `### ${title}\n${content}`)
		.join("\n\n")

	if (options?.omitUserInput) return body

	return `${body}\n\n### YOUR REPLY (as ${name}, spoken aloud):`
}

export const buildPromptContext = (
	domia: DomiaType,
	transcript: string,
	options?: BuildPromptContextOptionsType,
): string =>
	buildPromptFromPersona(personaContextFromDomia(domia), transcript, options)

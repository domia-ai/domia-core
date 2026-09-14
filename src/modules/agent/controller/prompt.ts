import { personalQuestionHit } from "@/modules/intent-router"
import { AGENT_PROMPT_MODE_ENUM } from "@/db"
import type { DomiaType } from "@/modules/core"
import {
	resolvePersonaName,
	buildPromptContext,
	renderNow,
	renderKnownFactsSection,
	renderKnowledgeBaseSection,
	KNOWN_FACTS_SECTION_TITLE,
	KNOWLEDGE_BASE_SECTION_TITLE,
} from "@/modules/prompt-context-builder"

import { SKILLS_CLAUSE, AGENT_COMPACT_FACT_LIMIT } from "../constants"
import type { AgentTurnOptionsType } from "../types"

const factsWanted = (domia: DomiaType, transcript: string): boolean =>
	domia.moduleSettings?.factRecall !== false &&
	personalQuestionHit(transcript, domia.characterProfile?.language) !== null

const memorySections = (
	domia: DomiaType,
	transcript: string,
	opts?: AgentTurnOptionsType,
): string => {
	const blocks: string[] = []
	const kb = opts?.knowledgeBase
	if (kb?.length)
		blocks.push(
			`### ${KNOWLEDGE_BASE_SECTION_TITLE}\n${renderKnowledgeBaseSection(kb)}`,
		)
	const facts = opts?.knownFacts
	if (factsWanted(domia, transcript) && facts?.length)
		blocks.push(
			`### ${KNOWN_FACTS_SECTION_TITLE}\n${renderKnownFactsSection(
				facts.slice(0, AGENT_COMPACT_FACT_LIMIT),
				domia.characterProfile?.language,
			)}`,
		)
	return blocks.length ? `\n\n${blocks.join("\n\n")}` : ""
}

export const buildAgentSystem = (
	domia: DomiaType,
	transcript: string,
	opts?: AgentTurnOptionsType,
): string => {
	const mode =
		domia.llmModelConfig?.agentPromptMode ?? AGENT_PROMPT_MODE_ENUM.COMPACT
	if (mode === AGENT_PROMPT_MODE_ENUM.FULL) {
		const persona = buildPromptContext(domia, transcript, {
			omitUserInput: true,
			knownFacts: factsWanted(domia, transcript) ? opts?.knownFacts : undefined,
			knowledgeBase: opts?.knowledgeBase,
		})
		return `### TOOLS (highest priority)\n${SKILLS_CLAUSE}\n\n${persona}`
	}
	const cp = domia.characterProfile
	const name = resolvePersonaName(domia)
	const lang = cp?.language || "en"
	const replyRule = `When you are not calling a tool, answer in one short, natural sentence in the user's language (default ${lang}); never describe the tools or your reasoning.`
	const nowLine =
		domia.moduleSettings?.environmentTimeEnabled !== false
			? `\n\n${renderNow(undefined, cp?.language)}`
			: ""
	if (mode === AGENT_PROMPT_MODE_ENUM.LEAN) {
		return `${SKILLS_CLAUSE}\n\nYou are ${name}. ${replyRule}${nowLine}`
	}
	const traits = [cp?.personality, cp?.communicationStyle]
		.map((t) => t?.trim().toLowerCase())
		.filter((t): t is string => Boolean(t) && t !== "neutral")
		.join(", ")
	const personaLine = traits
		? `You are ${name} — ${traits}.`
		: `You are ${name}.`
	return `${SKILLS_CLAUSE}\n\n${personaLine} ${replyRule} Stay in character.${nowLine}${memorySections(domia, transcript, opts)}`
}

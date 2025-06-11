import { getEmotionContext } from "@/modules/emotion-engine"
import { getCharacterContext } from "@/modules/character-engine"
import { DomiaType } from "@/modules/core"

import { INPUT_INTENT_TYPE_ENUM, InputIntentType } from "../types"
import {
	STATIC_DOMIA_PROMPT_FULL,
	STATIC_DOMIA_PROMPT_COMPACT,
} from "../constants"

export const classifyInputIntent = (
	domia: DomiaType,
	transcript: string,
): InputIntentType => {
	console.log("domia ==", domia)
	console.log("transcript ==", transcript)

	return {
		type: INPUT_INTENT_TYPE_ENUM.LLM_REQUEST,
	}
}

export const buildPromptContext = (
	domia: DomiaType,
	transcript: string,
): string => {
	const useCompactPrompt = domia?.llmModelConfig?.useCompactPrompt

	return [
		"### SYSTEM: DOMIA Context",
		useCompactPrompt ? STATIC_DOMIA_PROMPT_COMPACT : STATIC_DOMIA_PROMPT_FULL,
		"\n---\n",
		"### EMOTIONAL STATE",
		getEmotionContext(domia),
		"\n---\n",
		"### CHARACTER PROFILE",
		getCharacterContext(domia),
		"\n---\n",
		"### USER INPUT",
		transcript?.trim(),
		"\n---\n",
		"### RESPONSE",
		"DOMIA:",
	].join("\n")
}

import { languageSetsFor } from "@/utils"

import type { ReplyFallbackResultType, HeardReplyPlaybackType } from "../types"

const STEP_TO_PHRASE: Record<string, string> = {
	llm: "fallbackLlm",
	stt: "fallbackStt",
	network: "fallbackNetwork",
	capacity: "fallbackCapacity",
	generic: "fallbackGeneric",
}

export const resolveFallbackMessage = (
	step?: string,
	language?: string | null,
): string => {
	const phrases = languageSetsFor(language).phrases
	const key = (step && STEP_TO_PHRASE[step]) || "fallbackGeneric"
	return phrases[key]
}

export const ensureReplyOrFallback = (
	reply: string,
	language?: string | null,
): ReplyFallbackResultType =>
	reply.trim().length > 0
		? { reply, usedFallback: false }
		: { reply: resolveFallbackMessage("llm", language), usedFallback: true }

export const heardReplyOf = (
	reply: string,
	playback: HeardReplyPlaybackType,
): string => {
	if (!playback.audioStarted) return ""
	if (!playback.interrupted) return reply
	return playback.heardText ?? ""
}

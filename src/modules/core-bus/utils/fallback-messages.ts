import {
	languageSetsFor,
	domiaError,
	domiaBusLogger,
	LLM_ERRORS,
} from "@/utils"

import { extractEmotionTags } from "./emotion-tags"

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

export const spokenTextOf = (reply: string): string =>
	extractEmotionTags(reply).clean.trim()

export const emptyReplyError = (
	meta: Record<string, unknown>,
): ReturnType<typeof domiaError> =>
	domiaError(LLM_ERRORS.EMPTY_REPLY, { logger: domiaBusLogger, meta })

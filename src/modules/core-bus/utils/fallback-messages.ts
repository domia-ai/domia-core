export const FALLBACK_MESSAGES: Record<string, string> = {
	llm: "Sorry, I couldn't think of a reply. Please try again.",
	stt: "I didn't catch that. Could you say it again?",
	network: "I had a network problem. One moment, please.",
	capacity: "I'm helping another room right now. Give me a moment.",
	generic: "Sorry, something went wrong. Please try again.",
}

export const FALLBACK_GENERIC_KEY = "generic"

export const resolveFallbackMessage = (step?: string): string => {
	if (step && FALLBACK_MESSAGES[step]) return FALLBACK_MESSAGES[step]
	return FALLBACK_MESSAGES[FALLBACK_GENERIC_KEY]
}

export const ensureReplyOrFallback = (
	reply: string,
): { reply: string; usedFallback: boolean } =>
	reply.trim().length > 0
		? { reply, usedFallback: false }
		: { reply: resolveFallbackMessage("llm"), usedFallback: true }

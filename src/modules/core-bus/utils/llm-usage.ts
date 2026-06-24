import type { LlmUsageType } from "@/modules/llm-engine"

const usageByInteraction = new Map<string, LlmUsageType>()

export const recordLlmUsage = (
	interactionId: string,
	usage: LlmUsageType,
): void => {
	if (usageByInteraction.size > 256) {
		const oldest = usageByInteraction.keys().next().value
		if (oldest) usageByInteraction.delete(oldest)
	}
	usageByInteraction.set(interactionId, usage)
}

export const takeLlmUsage = (interactionId: string): LlmUsageType | null => {
	const usage = usageByInteraction.get(interactionId)
	if (usage) usageByInteraction.delete(interactionId)
	return usage ?? null
}

export const usageCols = (usage: LlmUsageType | null) =>
	usage
		? {
				llmPromptTokens: usage.promptTokens ?? null,
				llmCompletionTokens: usage.completionTokens ?? null,
				llmTokensPerSec: usage.tokensPerSec ?? null,
				llmTtftMs: usage.ttftMs ?? null,
				llmContextWindow: usage.contextWindow ?? null,
				llmFinishReason: usage.finishReason ?? null,
			}
		: {}

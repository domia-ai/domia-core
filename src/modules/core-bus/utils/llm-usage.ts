import type { LlmUsageType } from "@/modules/llm-engine"

import type { EouMetricsType, EouMetricsInputType } from "../types"

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
				llmRequestId: usage.requestId ?? null,
				llmFreshTokens: usage.freshTokens ?? null,
				llmCachedTokens: usage.cachedTokens ?? null,
			}
		: {}

const eouByInteraction = new Map<string, EouMetricsType>()

export const recordEouMetrics = (
	interactionId: string,
	metrics: EouMetricsInputType,
): void => {
	if (eouByInteraction.size > 256) {
		const oldest = eouByInteraction.keys().next().value
		if (oldest) eouByInteraction.delete(oldest)
	}
	eouByInteraction.set(interactionId, {
		transcriptionDelayMs: metrics.transcriptionDelayMs ?? null,
		eouDelayMs: metrics.eouDelayMs ?? null,
		endpointDebounceMs: metrics.endpointDebounceMs ?? null,
	})
}

export const eouCols = (interactionId: string): EouMetricsInputType => {
	const m = eouByInteraction.get(interactionId)
	if (!m) return {}
	eouByInteraction.delete(interactionId)
	return m
}

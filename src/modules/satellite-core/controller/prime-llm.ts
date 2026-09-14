import { randomUUID } from "crypto"

import type { DomiaType } from "@/modules/core"
import { runLLM } from "@/modules/llm-engine"
import { getRecentTurns, getRecentUserMoods } from "@/modules/session-manager"
import {
	getActiveFactStrings,
	getKnowledgeStrings,
	getPreviouslyStrings,
	getUserModelSummary,
} from "@/modules/memory"
import {
	personaContextFromDomia,
	buildPromptFromPersona,
} from "@/modules/prompt-context-builder"
import { satelliteGatewayLogger } from "@/utils"

const LLM_PRIME_MIN_INTERVAL_MS = 60_000
const lastLlmPrimeAt = new Map<string, number>()
export const primeLlmPrefix = (domia: DomiaType): void => {
	const now = Date.now()
	if (now - (lastLlmPrimeAt.get(domia.id) ?? 0) < LLM_PRIME_MIN_INTERVAL_MS)
		return
	lastLlmPrimeAt.set(domia.id, now)
	const cfg = domia.llmModelConfig
	if (!cfg) return
	void (async () => {
		const memoryOn = domia.moduleSettings?.memoryEngine !== false
		const emotionOn = domia.moduleSettings?.emotionEngine !== false
		const [
			recentTurns,
			knownFacts,
			knowledgeBase,
			previously,
			userModel,
			userMoodTrend,
		] = await Promise.all([
			memoryOn ? getRecentTurns(domia, randomUUID()) : [],
			domia.moduleSettings?.factRecall !== false
				? getActiveFactStrings(domia)
				: [],
			getKnowledgeStrings(domia),
			memoryOn ? getPreviouslyStrings(domia) : [],
			memoryOn ? getUserModelSummary(domia) : null,
			emotionOn ? getRecentUserMoods(domia) : [],
		])
		const prompt = buildPromptFromPersona(personaContextFromDomia(domia), "", {
			omitUserInput: true,
			recentTurns,
			knownFacts,
			knowledgeBase,
			previously,
			userModel: userModel ?? undefined,
			userMoodTrend,
		})
		await runLLM(
			{ ...domia, llmModelConfig: { ...cfg, numPredict: 1 } },
			prompt,
		)
		satelliteGatewayLogger.info("🔥 llm prefix primed")
	})().catch((err: unknown) =>
		satelliteGatewayLogger.warn("llm prefix priming failed (best-effort)", {
			err,
			domiaId: domia.id,
		}),
	)
}

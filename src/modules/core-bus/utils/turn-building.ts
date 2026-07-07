import type { DomiaType } from "@/modules/core"
import {
	buildPromptContext,
	type RecentTurnType,
} from "@/modules/prompt-context-builder"
import {
	rankFactsByRelevance,
	MEMORY_FACT_RECALL_LIMIT,
	KB_RECALL_LIMIT,
} from "@/modules/memory"
import { RESPONSE_TYPE_ENUM } from "@/db"

import { takeMemoryBundle } from "./prefetch-memory"
import { beginTurn } from "./turn-scope"
import type {
	SttDonePayloadType,
	SttFlowSessionType,
	TurnSessionContextType,
} from "../types"

export const buildSttFlowSession = (
	payload: SttDonePayloadType,
	interactionId: string,
	promptContext: string,
	recentTurns: RecentTurnType[],
	knownFacts: string[],
	userMoodTrend: string[],
	knowledgeBase: string[],
	previously: string[],
	userModel: string | null,
): SttFlowSessionType => ({
	interactionId,
	promptContext,
	speechEndAt: payload.speechEndAt,
	liveVoice: payload.liveVoice,
	transcript: payload.transcript,
	originDomiaKey: payload.originDomiaKey,
	responseType: payload.responseType,
	isVoice: payload.responseType !== RESPONSE_TYPE_ENUM.TEXT,
	recentTurns,
	knownFacts,
	userMoodTrend,
	knowledgeBase,
	previously,
	userModel,
})

export const buildTurnSession = async (
	domia: DomiaType,
	payload: SttDonePayloadType,
	interactionId: string,
	transcript: string,
	domiaId: string,
): Promise<TurnSessionContextType> => {
	const {
		recentTurns,
		knownFacts: candidateFacts,
		knowledgeBase: candidateKb,
		previously,
		userModel,
		userMoodTrend,
	} = await takeMemoryBundle(domia, interactionId)
	const [knownFacts, knowledgeBase] = await Promise.all([
		rankFactsByRelevance(
			domia,
			candidateFacts,
			transcript,
			MEMORY_FACT_RECALL_LIMIT,
		),
		rankFactsByRelevance(domia, candidateKb, transcript, KB_RECALL_LIMIT),
	])

	const session = buildSttFlowSession(
		payload,
		interactionId,
		payload.prestartedPrompt ??
			buildPromptContext(domia, transcript, {
				recentTurns,
				knownFacts,
				knowledgeBase,
				previously,
				userModel: userModel ?? undefined,
				userMoodTrend,
			}),
		recentTurns,
		knownFacts,
		userMoodTrend,
		knowledgeBase,
		previously,
		userModel,
	)

	const scope =
		session.isVoice && session.liveVoice === true
			? beginTurn(domiaId, interactionId)
			: null
	return { session, scope, turnSignal: scope?.signal }
}

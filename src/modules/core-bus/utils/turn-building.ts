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
import { markLadderStage } from "./stage-ladder"
import type {
	SttDonePayloadType,
	SttFlowSessionType,
	TurnSessionContextType,
	MemoryBundleType,
	RankedPromptContextType,
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

export const buildRankedPromptContext = async (
	domia: DomiaType,
	transcript: string,
	bundle: MemoryBundleType,
	preranked?: { knownFacts: string[]; knowledgeBase: string[] },
): Promise<RankedPromptContextType> => {
	const [knownFacts, knowledgeBase] = preranked
		? [preranked.knownFacts, preranked.knowledgeBase]
		: await Promise.all([
				rankFactsByRelevance(
					domia,
					bundle.knownFacts,
					transcript,
					MEMORY_FACT_RECALL_LIMIT,
				),
				rankFactsByRelevance(
					domia,
					bundle.knowledgeBase,
					transcript,
					KB_RECALL_LIMIT,
				),
			])
	return {
		knownFacts,
		knowledgeBase,
		prompt: buildPromptContext(domia, transcript, {
			recentTurns: bundle.recentTurns,
			knownFacts,
			knowledgeBase,
			previously: bundle.previously,
			userModel: bundle.userModel ?? undefined,
			userMoodTrend: bundle.userMoodTrend,
		}),
	}
}

export const buildTurnSession = async (
	domia: DomiaType,
	payload: SttDonePayloadType,
	interactionId: string,
	transcript: string,
	domiaId: string,
): Promise<TurnSessionContextType> => {
	const bundle = await takeMemoryBundle(domia, interactionId)
	const { recentTurns, previously, userModel, userMoodTrend } = bundle
	const eager = payload.eagerPrefill
	const reusableFacts =
		eager &&
		(eager.relation === "equal" || eager.relation === "extends") &&
		eager.knownFacts !== undefined &&
		eager.knowledgeBase !== undefined
			? { knownFacts: eager.knownFacts, knowledgeBase: eager.knowledgeBase }
			: undefined
	const { knownFacts, knowledgeBase, prompt } = await buildRankedPromptContext(
		domia,
		transcript,
		bundle,
		reusableFacts,
	)

	const session = buildSttFlowSession(
		payload,
		interactionId,
		payload.prestartedPrompt ?? prompt,
		recentTurns,
		knownFacts,
		userMoodTrend,
		knowledgeBase,
		previously,
		userModel,
	)

	markLadderStage(interactionId, "promptReadyAt")
	const scope =
		session.isVoice && session.liveVoice === true
			? beginTurn(domiaId, interactionId)
			: null
	return { session, scope, turnSignal: scope?.signal }
}

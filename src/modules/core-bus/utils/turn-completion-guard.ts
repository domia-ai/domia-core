import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import { getTraceContext } from "@/utils"
import {
	getInteractionById,
	updateInteraction,
} from "@/modules/session-manager"

import { ladderCols } from "./stage-ladder"
import type { TurnCompletionGuardOptsType } from "../types"

const emitted = new Set<string>()
const MAX_TRACKED = 512

export const claimTurnCompleted = (interactionId: string): boolean => {
	if (emitted.has(interactionId)) return false
	emitted.add(interactionId)
	if (emitted.size > MAX_TRACKED) {
		const oldest = emitted.values().next().value
		if (oldest !== undefined) emitted.delete(oldest)
	}
	return true
}

export const emitTerminalCompletion = async (
	interactionId: string,
	originDomiaKey: string,
	opts: TurnCompletionGuardOptsType = {},
): Promise<void> => {
	if (!claimTurnCompleted(interactionId)) return
	const ladder = ladderCols(interactionId)
	if (Object.keys(ladder).length > 0)
		await updateInteraction({ id: interactionId, ...ladder }).catch(
			() => undefined,
		)
	const trace = await getInteractionById(interactionId)
	const traceId = opts.traceId ?? getTraceContext()?.traceId
	if (trace?.llmMs != null) {
		emitTurnEvent({
			type: DOMIA_TURN_EVENT_ENUM.LLM_DONE,
			interactionId,
			originDomiaKey,
			traceId,
			llmMs: trace.llmMs,
			llmQueueMs: trace.llmQueueMs ?? undefined,
			promptTokens: trace.llmPromptTokens ?? undefined,
			completionTokens: trace.llmCompletionTokens ?? undefined,
			finishReason: trace.llmFinishReason ?? undefined,
		})
	}
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED,
		interactionId,
		originDomiaKey,
		traceId,
		status: opts.status ?? "ok",
		ttfaMs: trace?.ttfaMs ?? undefined,
		perceivedTtfaMs: trace?.perceivedTtfaMs ?? undefined,
		llmQueueMs: trace?.llmQueueMs ?? undefined,
		llmFirstSentenceMs: trace?.llmFirstSentenceMs ?? undefined,
		ttsFirstChunkMs: trace?.ttsFirstChunkMs ?? undefined,
		llmMs: trace?.llmMs ?? undefined,
		ttsMs: trace?.ttsMs ?? undefined,
		totalMs: trace?.totalMs ?? undefined,
	})
}

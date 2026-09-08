import {
	publishToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	emitTurnEvent,
	DOMIA_TURN_EVENT_ENUM,
} from "@/buses"
import { domiaBusLogger, getTraceContext } from "@/utils"
import {
	eouCols,
	ladderCols,
	extractEmotionTags,
	claimTurnCompleted,
} from "../../utils"
import { applyExpressedEmotionTags } from "@/modules/emotion-engine"
import { updateInteraction } from "@/modules/session-manager"
import type { DomiaType } from "@/modules/core"
import type { SttFlowSessionType, PlaybackOutcomeType } from "../../types"

const numOrUndef = (v: unknown): number | undefined =>
	typeof v === "number" ? v : undefined

export const persistTurnComplete = async (
	payload: Parameters<typeof updateInteraction>[0],
	emitCompletion = true,
): Promise<Awaited<ReturnType<typeof updateInteraction>>> => {
	const p = payload as Record<string, unknown>
	const earlyId = typeof p.id === "string" ? p.id : ""
	// claim BEFORE the await: playback-finished races this write on the streaming path
	const claimed =
		emitCompletion && earlyId ? claimTurnCompleted(earlyId) : false
	await updateInteraction(
		earlyId
			? { ...payload, ...eouCols(earlyId), ...ladderCols(earlyId) }
			: payload,
	)
	if (!emitCompletion) return
	const ctx = getTraceContext()
	const interactionId = earlyId || (ctx?.interactionId ?? "")
	if (interactionId) {
		if (numOrUndef(p.llmMs) !== undefined) {
			emitTurnEvent({
				type: DOMIA_TURN_EVENT_ENUM.LLM_DONE,
				interactionId,
				originDomiaKey: ctx?.originDomiaKey ?? "",
				traceId: ctx?.traceId,
				llmMs: numOrUndef(p.llmMs),
				llmQueueMs: numOrUndef(p.llmQueueMs),
				promptTokens: numOrUndef(p.llmPromptTokens),
				completionTokens: numOrUndef(p.llmCompletionTokens),
				finishReason:
					typeof p.llmFinishReason === "string" ? p.llmFinishReason : undefined,
			})
		}
		if (claimed) {
			emitTurnEvent({
				type: DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED,
				interactionId,
				originDomiaKey: ctx?.originDomiaKey ?? "",
				traceId: ctx?.traceId,
				status: typeof p.status === "string" ? p.status : "ok",
				ttfaMs: numOrUndef(p.ttfaMs),
				perceivedTtfaMs: numOrUndef(p.perceivedTtfaMs),
				llmQueueMs: numOrUndef(p.llmQueueMs),
				llmFirstSentenceMs: numOrUndef(p.llmFirstSentenceMs),
				ttsFirstChunkMs: numOrUndef(p.ttsFirstChunkMs),
				llmMs: numOrUndef(p.llmMs),
				ttsMs: numOrUndef(p.ttsMs),
				totalMs: numOrUndef(p.totalMs),
			})
		}
	}
	return
}

export const finalizeExpressedEmotion = (
	domia: DomiaType,
	reply: string,
): string => {
	const expressed = extractEmotionTags(reply)
	if (expressed.tags.length === 0) return reply
	try {
		applyExpressedEmotionTags(domia, expressed.tags)
	} catch (err) {
		domiaBusLogger.warn("expressed emotion apply failed", {
			domiaId: domia.id,
			err,
		})
	}
	return expressed.clean
}

export const publishStreamedReplyComplete = (
	domiaId: string,
	session: SttFlowSessionType,
	reply: string,
	playback: PlaybackOutcomeType,
): void => {
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
		reply,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		alreadyStreamed: true,
		liveVoice: session.liveVoice,
	})
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
	})
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		status: playback.interrupted ? "interrupted" : "completed",
		playedLocally: playback.audioStarted,
		positionMs: playback.positionMs,
		liveVoice: session.liveVoice,
	})
}

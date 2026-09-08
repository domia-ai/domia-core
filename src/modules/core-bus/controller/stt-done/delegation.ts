import { domiaBusLogger, toError, domiaError, GRPC_ERRORS } from "@/utils"
import {
	DEFAULT_SAMPLE_RATE,
	ensureReplyOrFallback,
	heardReplyOf,
	notifyInteractionFailed,
	playStreamedAudio,
} from "../../utils"
import { updateInteraction, pipelineElapsed } from "@/modules/session-manager"
import { buildDelegationPersona } from "@/modules/prompt-context-builder"
import { reflectOnInteraction } from "@/modules/reflection"
import { deliverReply } from "../llm-done"
import {
	streamLlmFromTarget,
	streamReplyAudioFromTarget,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type { CoreBusContextType, SttFlowSessionType } from "../../types"
import {
	persistTurnComplete,
	finalizeExpressedEmotion,
	publishStreamedReplyComplete,
} from "./persist"
import { pipelineVoiceFromTokens } from "./pipeline"

export const tryDelegatedReplyAudio = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
): Promise<boolean> => {
	if (!session.isVoice || !ctx.features.canPlayback) return false
	const replyTargets = targets.filter(
		(target) =>
			target.streamingCapabilities.llm && target.streamingCapabilities.tts,
	)
	if (replyTargets.length === 0) return false

	const { domia } = ctx
	const startTime = Date.now()
	domiaBusLogger.info(
		`📡 streaming replyAudio delegation (${replyTargets.length} targets)`,
		{ domiaId: domia.id, interactionId: session.interactionId },
	)

	const streamed = await streamReplyAudioFromTarget(
		domia.domiaKey,
		replyTargets,
		{
			transcript: session.transcript,
			originDomiaKey: session.originDomiaKey,
			interactionId: session.interactionId,
			responseType: session.responseType,
			persona: buildDelegationPersona(domia, session),
		},
	)

	if (streamed.atCapacity) {
		domiaBusLogger.warn(
			`replyAudio delegation: hub at capacity — surfacing graceful busy (no fallback)`,
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			error: "hub at capacity",
			step: "capacity",
			liveVoice: session.liveVoice,
		})
		return true
	}

	if (!streamed.delivered || !streamed.audio) {
		domiaBusLogger.warn(
			`replyAudio delegation failed (${streamed.error ?? "unknown"}) — falling back to streamLlm`,
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
		return false
	}

	const audioIter = streamed.audio[Symbol.asyncIterator]()
	let audioEmitted = false as boolean
	const trackedAudio = (async function* (): AsyncIterable<Buffer> {
		try {
			while (true) {
				const next = await audioIter.next()
				if (next.done) break
				audioEmitted = true
				yield next.value
			}
		} finally {
			await audioIter.return?.().catch(() => undefined)
		}
	})()

	try {
		const channels = streamed.channels === 2 ? 2 : 1
		let ttfaMs: number | undefined
		let perceivedTtfaMs: number | undefined
		const playback = await playStreamedAudio(
			ctx,
			trackedAudio,
			{
				interactionId: session.interactionId,
				originDomiaKey: session.originDomiaKey,
				onFirstChunk: () => {
					ttfaMs = pipelineElapsed(session.interactionId) ?? undefined
					if (session.speechEndAt) {
						perceivedTtfaMs = Date.now() - session.speechEndAt
					}
				},
			},
			{
				sampleRate: streamed.sampleRate ?? DEFAULT_SAMPLE_RATE,
				channels,
			},
		)
		const reply = finalizeExpressedEmotion(
			domia,
			(await streamed.finalReplyPromise) ?? "",
		)
		domiaBusLogger.info(
			`⏱️ replyAudio delegation pipeline: ${Date.now() - startTime}ms`,
		)
		const heardReply = heardReplyOf(reply, playback)
		await persistTurnComplete({
			id: session.interactionId,
			llmPrompt: session.promptContext,
			llmResponse: reply,
			heardReply,
			llmExecutorKey: streamed.target?.domiaKey,
			ttsExecutorKey: streamed.target?.domiaKey,
			ttsAudioPath: playback.filePath,
			ttfaMs,
			perceivedTtfaMs,
			totalMs: pipelineElapsed(session.interactionId),
		})
		publishStreamedReplyComplete(domia.id, session, reply, playback)
		if (heardReply) {
			void reflectOnInteraction(
				domia,
				session.transcript,
				heardReply,
				session.interactionId,
				session.originDomiaKey,
			)
		}
		return true
	} catch (err) {
		await audioIter.return?.().catch(() => undefined)
		if (!audioEmitted) {
			domiaBusLogger.warn(
				`replyAudio delegation playback failed (${err instanceof Error ? err.message : "unknown"}) — falling back`,
				{ domiaId: domia.id, interactionId: session.interactionId },
			)
			return false
		}
		domiaBusLogger.warn(
			`replyAudio delegation playback failed after audio started — NOT falling back (would double-reply)`,
			{ domiaId: domia.id, interactionId: session.interactionId, err },
		)
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			error: err as Error,
			step: "playback",
			silent: true,
			liveVoice: session.liveVoice,
		})
		return true
	}
}

export const runDelegatedStreamLlm = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
): Promise<void> => {
	const orderedTargets = [...targets].sort(
		(a, b) =>
			Number(b.streamingCapabilities.llm) - Number(a.streamingCapabilities.llm),
	)

	const { domia } = ctx
	domiaBusLogger.info(
		`📡 streaming LLM delegation (${orderedTargets.length} targets)`,
		{ domiaId: domia.id, interactionId: session.interactionId },
	)
	const streamed = await streamLlmFromTarget(domia.domiaKey, orderedTargets, {
		transcript: session.transcript,
		originDomiaKey: session.originDomiaKey,
		interactionId: session.interactionId,
		responseType: session.responseType,
		persona: buildDelegationPersona(domia, session),
	})

	if (!streamed.delivered || !streamed.tokens) {
		throw domiaError(GRPC_ERRORS.DELEGATION_FAILED, {
			messageOverride: `STT_DONE delegation failed: ${streamed.error ?? "unknown"} (tried ${streamed.attemptedTargets})`,
			meta: {
				interactionId: session.interactionId,
				attemptedTargets: streamed.attemptedTargets,
			},
		})
	}

	if (session.isVoice && ctx.features.canRunTts && ctx.features.canPlayback) {
		const piped = await pipelineVoiceFromTokens(ctx, session, streamed.tokens, {
			llmExecutorKey: streamed.target?.domiaKey,
			llmModelUsed: null,
		})
		if (piped) return
	}

	let collected = ""
	for await (const token of streamed.tokens) collected += token
	const { reply } = ensureReplyOrFallback(
		collected,
		ctx.domia.characterProfile?.language,
	)
	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: reply,
		llmExecutorKey: streamed.target?.domiaKey,
	})
	void deliverReply(ctx, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
	}).catch((err: unknown) => {
		domiaBusLogger.error("runDelegatedStreamLlm deliverReply failed", {
			domiaId: domia.id,
			interactionId: session.interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			error: toError(err),
			step: "delivery",
			liveVoice: session.liveVoice,
		})
	})
}

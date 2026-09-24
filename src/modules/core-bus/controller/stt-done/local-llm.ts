import { domiaBusLogger, toError, withIdleTimeout } from "@/utils"
import {
	ensureReplyOrFallback,
	notifyInteractionFailed,
	getStreamingSink,
	isTurnAborted,
	notifyTurnAborted,
	recordLlmUsage,
	takeLlmUsage,
	usageCols,
	takeReplyQueueWait,
	resourceCols,
	getInteractionRuntime,
	hasInteractionDeltaSink,
	pushInteractionDelta,
	createTextDeltaEmitter,
} from "../../utils"
import { updateInteraction, pipelineElapsed } from "@/modules/session-manager"
import { DEFAULT_LLM_STREAM_IDLE_MS } from "@/db"
import { reflectOnInteraction } from "@/modules/reflection"
import { runLLM, type LlmUsageType } from "@/modules/llm-engine"
import { deliverReply } from "../llm-done"
import type {
	CoreBusContextType,
	SttFlowSessionType,
	PipelinePrefixType,
} from "../../types"
import { persistTurnComplete, finalizeExpressedEmotion } from "./persist"
import { pipelineVoiceFromTokens } from "./pipeline"

export const tryLocalFullStreamVoice = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	prestartedTokens?: AsyncIterable<string>,
	prefix?: PipelinePrefixType,
): Promise<boolean> => {
	const { features, domia } = ctx
	const { llm, tts, canSentencePipeline } = features
	const pipelineForSink = getStreamingSink(session.interactionId) !== undefined
	const delivery = getInteractionRuntime(session.interactionId)?.delivery
		.audioDelivery
	if (
		delivery === "none" ||
		!session.isVoice ||
		(!canSentencePipeline && !pipelineForSink) ||
		!llm ||
		!tts
	)
		return false
	if (!llm.adapter.runStream) return false

	return pipelineVoiceFromTokens(
		ctx,
		session,
		prestartedTokens ??
			withIdleTimeout(
				llm.adapter.runStream(
					domia,
					session.promptContext,
					() => isTurnAborted(domia.id, session.interactionId),
					(u) => recordLlmUsage(session.interactionId, u),
				),
				domia.llmModelConfig?.llmStreamIdleMs ?? DEFAULT_LLM_STREAM_IDLE_MS,
				"llm",
			),
		{
			llmExecutorKey: domia.domiaKey,
			llmModelUsed: domia.llmModelConfig?.modelName ?? null,
		},
		prestartedTokens ? prefix : undefined,
	)
}

const generateReplyText = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): Promise<string> => {
	const { domia, features } = ctx
	const onUsage = (u: LlmUsageType): void =>
		recordLlmUsage(session.interactionId, u)
	const runStream = features.llm?.adapter.runStream
	if (!runStream || !hasInteractionDeltaSink(session.interactionId))
		return await runLLM(domia, session.promptContext, onUsage)

	const emitter = createTextDeltaEmitter((delta) =>
		pushInteractionDelta(session.interactionId, delta),
	)
	const tokens = withIdleTimeout(
		runStream(
			domia,
			session.promptContext,
			() => isTurnAborted(domia.id, session.interactionId),
			onUsage,
		),
		domia.llmModelConfig?.llmStreamIdleMs ?? DEFAULT_LLM_STREAM_IDLE_MS,
		"llm",
	)
	let collected = ""
	for await (const token of tokens) {
		collected += token
		emitter.push(token)
	}
	emitter.flush()
	return collected
}

export const runLocalSyncLlm = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): Promise<void> => {
	const startTime = Date.now()
	const { reply: rawReply } = ensureReplyOrFallback(
		await generateReplyText(ctx, session),
		ctx.domia.characterProfile?.language,
	)
	const reply = finalizeExpressedEmotion(ctx.domia, rawReply)
	const llmElapsed = Date.now() - startTime
	domiaBusLogger.info(`⏱️ LLM execution time: ${llmElapsed}ms`)

	if (isTurnAborted(ctx.domia.id, session.interactionId)) {
		await notifyTurnAborted(
			ctx.domia.id,
			session.interactionId,
			session.originDomiaKey,
			reply,
		)
		return
	}

	await persistTurnComplete(
		{
			id: session.interactionId,
			llmPrompt: session.promptContext,
			llmResponse: reply,
			llmExecutorKey: ctx.domia.domiaKey,
			llmMs: llmElapsed,
			...usageCols(takeLlmUsage(session.interactionId)),
			...resourceCols(ctx.domia),
			llmQueueMs: takeReplyQueueWait(session.interactionId),
			llmModelUsed: ctx.domia.llmModelConfig?.modelName ?? null,
			totalMs: pipelineElapsed(session.interactionId),
		},
		!session.isVoice,
	)

	void deliverReply(ctx, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
	}).catch((err: unknown) => {
		domiaBusLogger.error("runLocalSyncLlm deliverReply failed", {
			domiaId: ctx.domia.id,
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
	if (!session.isVoice) {
		await updateInteraction({ id: session.interactionId, heardReply: reply })
		void reflectOnInteraction(
			ctx.domia,
			session.transcript,
			reply,
			session.interactionId,
			session.originDomiaKey,
		)
	}
}

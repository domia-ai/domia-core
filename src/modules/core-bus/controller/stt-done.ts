import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import {
	domiaBusLogger,
	isSemaphoreBusyError,
	setTraceContext,
	toError,
} from "@/utils"
import {
	AsyncQueue,
	concatStreams,
	DEFAULT_SAMPLE_RATE,
	eagerTtsSlotsFromDomia,
	ensureReplyOrFallback,
	heardReplyOf,
	notifyAudioFallback,
	notifyInteractionFailed,
	pipelineDepthFromDomia,
	playStreamedAudio,
	primeStream,
	splitSentences,
	takeMemoryBundle,
	sentenceTuningFromDomia,
	getStreamingSink,
	isTurnAborted,
	notifyTurnAborted,
} from "../utils"
import {
	getOrCreateInteractionId,
	updateInteraction,
	pipelineElapsed,
} from "@/modules/session-manager"
import {
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	INTERACTION_STATUS_ENUM,
	RESPONSE_TYPE_ENUM,
	type SkillToolType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import {
	buildPromptContext,
	personaContextFromDomia,
	type RecentTurnType,
} from "@/modules/prompt-context-builder"
import { reflectOnInteraction } from "@/modules/reflection"
import { playFeedbackSound } from "@/modules/feedback-sounds"
import { admitVoiceReply } from "@/modules/voice-admission"
import {
	runLLM,
	runLLMWithTools,
	runLLMReplyStreamOrTools,
} from "@/modules/llm-engine"
import {
	runAgentTurn,
	type AgentInferenceType,
	type AgentStreamInferenceType,
	type AgentResultType,
} from "@/modules/agent"
import { classifyNeedsSkill } from "@/modules/intent-router"
import { ttsAdapterToPcmChunks } from "@/modules/tts-engine"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import {
	streamLlmFromTarget,
	streamReplyAudioFromTarget,
	delegateInferenceWithTools,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type {
	CoreBusContextType,
	SttDonePayloadType,
	SttFlowSessionType,
	PlaybackOutcomeType,
} from "../types"

const buildSttFlowSession = (
	payload: SttDonePayloadType,
	interactionId: string,
	promptContext: string,
	recentTurns: RecentTurnType[],
	knownFacts: string[],
	userMoodTrend: string[],
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
})

const publishStreamedReplyComplete = (
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
		liveVoice: session.liveVoice,
	})
}

const pipelineVoiceFromTokens = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	tokens: AsyncIterable<string>,
	executors: {
		llmExecutorKey: string | undefined
		llmModelUsed: string | null
	},
): Promise<boolean> => {
	const { features, domia } = ctx
	const tts = features.tts
	if (!tts) return false

	const startTime = Date.now()
	const ttsStreamQueue = new AsyncQueue<AsyncIterable<Buffer>>()
	const caps = tts.adapter.capabilities
	const queueDepth = pipelineDepthFromDomia(domia)
	const eagerSlots = eagerTtsSlotsFromDomia(domia)

	let ttfaMs: number | undefined
	let perceivedTtfaMs: number | undefined
	let playbackGone = false
	const playbackPromise = playStreamedAudio(
		ctx,
		concatStreams(ttsStreamQueue.iter()),
		{
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			aborted: () => isTurnAborted(domia.id, session.interactionId),
			onFirstChunk: () => {
				ttfaMs =
					pipelineElapsed(session.interactionId) ?? Date.now() - startTime
				if (session.speechEndAt) {
					perceivedTtfaMs = Date.now() - session.speechEndAt
				}
			},
		},
		{ sampleRate: caps.sampleRate, channels: caps.channels },
	).then(
		(outcome) => {
			if (outcome.interrupted) {
				playbackGone = true
				ttsStreamQueue.close()
			}
			return outcome
		},
		(err: unknown) => {
			playbackGone = true
			ttsStreamQueue.close()
			throw err
		},
	)

	let fullReply = ""
	let tokenError: unknown = null
	let playbackError: unknown = null
	let playback: PlaybackOutcomeType = {
		filePath: undefined,
		interrupted: false,
		audioStarted: false,
	}
	try {
		for await (const sentence of splitSentences(
			tokens,
			sentenceTuningFromDomia(domia),
		)) {
			if (playbackGone || isTurnAborted(domia.id, session.interactionId)) break
			fullReply += (fullReply.length > 0 ? " " : "") + sentence
			await ttsStreamQueue.waitForSpace(queueDepth)
			ttsStreamQueue.push(
				primeStream(
					ttsAdapterToPcmChunks(domia, tts.adapter, sentence),
					eagerSlots,
				),
			)
		}
	} catch (err) {
		tokenError = err
	}
	const aborted = isTurnAborted(domia.id, session.interactionId)
	if (!tokenError && !aborted) {
		const ensured = ensureReplyOrFallback(fullReply)
		if (ensured.usedFallback) {
			domiaBusLogger.warn("LLM returned empty reply — speaking fallback", {
				domiaId: domia.id,
				interactionId: session.interactionId,
			})
			fullReply = ensured.reply
			ttsStreamQueue.push(ttsAdapterToPcmChunks(domia, tts.adapter, fullReply))
		}
	}
	ttsStreamQueue.close()
	const llmElapsed = Date.now() - startTime
	try {
		playback = await playbackPromise
	} catch (err) {
		playbackError = err
	}

	const totalElapsed = Date.now() - startTime
	domiaBusLogger.info(`⏱️ LLM+TTS streaming pipeline: ${totalElapsed}ms`)

	if (tokenError) {
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			error: toError(tokenError),
			step: "llm",
			liveVoice: session.liveVoice,
		})
		return true
	}

	if (aborted) {
		await updateInteraction({
			id: session.interactionId,
			status: INTERACTION_STATUS_ENUM.ABORTED,
			llmPrompt: session.promptContext,
			llmResponse: fullReply,
			ttsEngineUsed: tts.adapter.id,
			ttsExecutorKey: domia.domiaKey,
			ttsAudioPath: playback.filePath,
			totalMs: pipelineElapsed(session.interactionId),
		})
		publishStreamedReplyComplete(domia.id, session, fullReply, playback)
		domiaBusLogger.info(`🛑 turn aborted mid-pipeline — reflection skipped`, {
			domiaId: domia.id,
			interactionId: session.interactionId,
		})
		return true
	}

	const heardReply = heardReplyOf(fullReply, playback)
	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: fullReply,
		heardReply,
		ttsEngineUsed: tts.adapter.id,
		llmExecutorKey: executors.llmExecutorKey,
		ttsExecutorKey: domia.domiaKey,
		ttsAudioPath: playback.filePath,
		// pipelined: llmMs = reply-generation span, ttsMs = audio tail; they overlap (sum ≥ wall) — ttfaMs is the headline
		llmMs: llmElapsed,
		ttsMs: Math.max(0, totalElapsed - llmElapsed),
		llmModelUsed: executors.llmModelUsed,
		ttsVoiceUsed: domia.ttsConfig?.voiceName ?? null,
		ttfaMs,
		perceivedTtfaMs,
		totalMs: pipelineElapsed(session.interactionId),
	})

	if (playbackError) {
		publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
			reply: fullReply,
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			alreadyStreamed: true,
		})
		notifyAudioFallback(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			reason: "tts_failed",
			error: toError(playbackError),
			reply: fullReply,
		})
		return true
	}

	publishStreamedReplyComplete(domia.id, session, fullReply, playback)
	if (heardReply) {
		void reflectOnInteraction(
			domia,
			session.transcript,
			heardReply,
			session.interactionId,
			session.originDomiaKey,
		)
	} else {
		domiaBusLogger.info(
			`🪞 reflection skipped — reply not heard (interrupted/no audio)`,
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
	}
	return true
}

const tryLocalFullStreamVoice = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	prestartedTokens?: AsyncIterable<string>,
): Promise<boolean> => {
	const { features, domia } = ctx
	const { llm, tts, canSentencePipeline } = features
	const pipelineForSink = getStreamingSink(session.interactionId) !== undefined
	if (
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
			llm.adapter.runStream(domia, session.promptContext, () =>
				isTurnAborted(domia.id, session.interactionId),
			),
		{
			llmExecutorKey: domia.domiaKey,
			llmModelUsed: domia.llmModelConfig?.modelName ?? null,
		},
	)
}

const runLocalSyncLlm = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): Promise<void> => {
	const startTime = Date.now()
	const { reply } = ensureReplyOrFallback(
		await runLLM(ctx.domia, session.promptContext),
	)
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

	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: reply,
		llmExecutorKey: ctx.domia.domiaKey,
		llmMs: llmElapsed,
		llmModelUsed: ctx.domia.llmModelConfig?.modelName ?? null,
		totalMs: pipelineElapsed(session.interactionId),
	})

	publishToDomiaBus(ctx.domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
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

const skillsEnabled = (ctx: CoreBusContextType): boolean =>
	ctx.domia.moduleSettings?.skillsEngine === true

const cachedToolsOf = (domia: DomiaType): SkillToolType[] =>
	(domia.skillProviders ?? [])
		.filter((s) => s.isActive)
		.flatMap((s) => s.toolsCache ?? [])

const withAgentSummary = (result: AgentResultType): unknown[] | null => {
	if (!result.skillResponses.length) return null
	return [
		...result.skillResponses,
		{
			__summary: {
				decisionMs: result.decisionMs,
				toolMs: result.toolMs,
				finalizeMs: result.finalizeMs,
				finalizeMode: result.finalizeMode,
			},
		},
	]
}

const agentTimingCols = (
	result: AgentResultType,
): {
	agentDecisionMs: number | null
	agentToolMs: number | null
	agentFinalizeMs: number | null
} => ({
	agentDecisionMs: result.decisionMs ?? null,
	agentToolMs: result.toolMs ?? null,
	agentFinalizeMs: result.finalizeMs ?? null,
})

const tryAgentTurn = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	tools: SkillToolType[],
	inference: AgentInferenceType,
	executor: { key: string; model: string | null },
	streamFinalize?: AgentStreamInferenceType,
): Promise<boolean> => {
	const { domia } = ctx
	const startTime = Date.now()
	let result: AgentResultType
	try {
		result = await runAgentTurn(domia, session.transcript, tools, inference, {
			voice: session.isVoice,
			streamFinalize,
		})
	} catch (err) {
		domiaBusLogger.warn("agent turn failed — falling through to normal LLM", {
			domiaId: domia.id,
			interactionId: session.interactionId,
			err,
		})
		return false
	}

	if (result.replyStream && session.isVoice) {
		await updateInteraction({
			id: session.interactionId,
			skillProviderUsed: result.serversUsed.join(",") || null,
			skillPrompt: result.skillPrompt,
			skillResponse: withAgentSummary(result),
			...agentTimingCols(result),
		})
		return pipelineVoiceFromTokens(ctx, session, result.replyStream, {
			llmExecutorKey: executor.key,
			llmModelUsed: executor.model,
		})
	}

	const { reply } = ensureReplyOrFallback(result.reply)
	const llmElapsed = Date.now() - startTime

	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: reply,
		llmExecutorKey: executor.key,
		llmMs: result.finalizeMs ?? llmElapsed,
		llmModelUsed: executor.model,
		skillProviderUsed: result.serversUsed.join(",") || null,
		skillPrompt: result.skillPrompt,
		skillResponse: withAgentSummary(result),
		...agentTimingCols(result),
		totalMs: pipelineElapsed(session.interactionId),
	})

	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
	})

	if (!session.isVoice) {
		await updateInteraction({ id: session.interactionId, heardReply: reply })
		void reflectOnInteraction(
			domia,
			session.transcript,
			reply,
			session.interactionId,
			session.originDomiaKey,
		)
	}
	return true
}

const tryDelegatedReplyAudio = async (
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
			personaContextJson: JSON.stringify(
				personaContextFromDomia(
					domia,
					session.recentTurns,
					session.knownFacts,
					session.userMoodTrend,
				),
			),
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
	let audioEmitted = false
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
		const channels = (streamed.channels === 2 ? 2 : 1) as 1 | 2
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
		const reply = (await streamed.finalReplyPromise) ?? ""
		domiaBusLogger.info(
			`⏱️ replyAudio delegation pipeline: ${Date.now() - startTime}ms`,
		)
		const heardReply = heardReplyOf(reply, playback)
		await updateInteraction({
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
				`replyAudio delegation playback failed (${(err as Error)?.message ?? "unknown"}) — falling back`,
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

const runDelegatedStreamLlm = async (
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
		personaContextJson: JSON.stringify(
			personaContextFromDomia(
				domia,
				session.recentTurns,
				session.knownFacts,
				session.userMoodTrend,
			),
		),
	})

	if (!streamed.delivered || !streamed.tokens) {
		throw new Error(
			`STT_DONE delegation failed: ${streamed.error ?? "unknown"} (tried ${streamed.attemptedTargets})`,
		)
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
	const { reply } = ensureReplyOrFallback(collected)
	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: reply,
		llmExecutorKey: streamed.target?.domiaKey,
	})
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
	})
}

export const handleSttDone = async (
	ctx: CoreBusContextType,
	payload: SttDonePayloadType,
): Promise<void> => {
	const { domia } = ctx
	const domiaId = domia.id
	const { transcript, originDomiaKey } = payload

	setTraceContext({ interactionId: payload.interactionId, originDomiaKey })
	domiaBusLogger.info(`📝 STT_DONE: ${transcript}`, { domiaId })

	if (payload.alreadyHandled) {
		domiaBusLogger.info(
			`📝 STT_DONE: alreadyHandled — fused voice reply already ran, skipping`,
			{ domiaId, interactionId: payload.interactionId },
		)
		return
	}

	if (payload.interactionId && isTurnAborted(domiaId, payload.interactionId)) {
		await notifyTurnAborted(domiaId, payload.interactionId, originDomiaKey)
		return
	}

	try {
		await handleSttDoneFlow(ctx, payload)
	} finally {
		payload.prestartedRelease?.()
	}
}

const handleSttDoneFlow = async (
	ctx: CoreBusContextType,
	payload: SttDonePayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const domiaId = domia.id
	const { transcript, originDomiaKey, responseType } = payload

	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
			inputRaw: transcript,
			sttResult: transcript,
			responseType:
				responseType === RESPONSE_TYPE_ENUM.VOICE
					? RESPONSE_TYPE_ENUM.VOICE
					: RESPONSE_TYPE_ENUM.TEXT,
		},
	)
	if (!interactionId) return
	setTraceContext({ interactionId, originDomiaKey })

	void updateInteraction({
		id: interactionId,
		inputRaw: transcript,
		sttResult: transcript,
	}).catch((err) =>
		domiaBusLogger.error("STT_DONE: snapshot persistence failed", {
			domiaId,
			interactionId,
			err,
		}),
	)

	const { recentTurns, knownFacts, userMoodTrend } = await takeMemoryBundle(
		domia,
		interactionId,
	)

	const session = buildSttFlowSession(
		payload,
		interactionId,
		payload.prestartedPrompt ??
			buildPromptContext(domia, transcript, {
				recentTurns,
				knownFacts,
				userMoodTrend,
			}),
		recentTurns,
		knownFacts,
		userMoodTrend,
	)

	try {
		if (features.canRunLlm) {
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PROCESSING_STARTED, {
				interactionId,
				originDomiaKey,
				liveVoice: payload.liveVoice,
			})
			if (payload.liveVoice) playFeedbackSound(domia, "thinking")
			const release =
				payload.prestartedRelease ??
				(await admitVoiceReply(domia).catch((err: unknown) => {
					if (isSemaphoreBusyError(err)) return null
					throw err
				}))
			if (!release) {
				notifyInteractionFailed(ctx, {
					interactionId,
					originDomiaKey,
					responseType,
					error: "at capacity — too many concurrent turns",
					step: "capacity",
					liveVoice: session.liveVoice,
				})
				return
			}
			try {
				if (skillsEnabled(ctx)) {
					const tools = cachedToolsOf(domia)
					if (tools.length > 0 && features.llm?.adapter.runWithTools) {
						const intentStart = Date.now()
						const decision = await classifyNeedsSkill(
							domia,
							session.transcript,
							tools.map((t) => ({
								name: t.rawName,
								description: t.description,
							})),
							{ canRunLlm: true },
						)
						const intentDecision = `${decision.needsSkill ? "skill" : "chat"} (${decision.reason})`
						const intentMs = Date.now() - intentStart
						domiaBusLogger.info(`🧭 intent: ${intentDecision} ${intentMs}ms`, {
							domiaId: domia.id,
						})
						void updateInteraction({
							id: session.interactionId,
							intentDecision,
							intentMs,
						})
						if (decision.needsSkill) {
							const inference: AgentInferenceType = (messages, toolDefs) =>
								runLLMWithTools(domia, messages, toolDefs)
							const streamFinalize: AgentStreamInferenceType | undefined =
								features.canSentencePipeline
									? (messages, toolDefs) =>
											runLLMReplyStreamOrTools(domia, messages, toolDefs)
									: undefined
							if (
								await tryAgentTurn(
									ctx,
									session,
									tools,
									inference,
									{
										key: domia.domiaKey,
										model: domia.llmModelConfig?.modelName ?? null,
									},
									streamFinalize,
								)
							)
								return
						}
					}
				}
				if (
					await tryLocalFullStreamVoice(ctx, session, payload.prestartedTokens)
				)
					return
				await runLocalSyncLlm(ctx, session)
				return
			} finally {
				release()
			}
		}

		if (payload.prestartedTokens) {
			if (
				session.isVoice &&
				features.canRunTts &&
				features.canPlayback &&
				(await pipelineVoiceFromTokens(ctx, session, payload.prestartedTokens, {
					llmExecutorKey: payload.prestartedExecutorKey,
					llmModelUsed: null,
				}))
			) {
				return
			}
			let collected = ""
			for await (const token of payload.prestartedTokens) collected += token
			const { reply } = ensureReplyOrFallback(collected)
			await updateInteraction({
				id: interactionId,
				llmPrompt: session.promptContext,
				llmResponse: reply,
				llmExecutorKey: payload.prestartedExecutorKey,
			})
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
				reply,
				transcript: session.transcript,
				interactionId,
				originDomiaKey,
				responseType,
				speechEndAt: payload.speechEndAt,
				liveVoice: payload.liveVoice,
			})
			return
		}

		const targets = await resolveCapabilityDelegations(
			domia,
			CAPABILITY_ENUM.LLM,
		)
		if (targets.length === 0) {
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
				capability: CAPABILITY_ENUM.LLM,
				interactionId,
				originDomiaKey,
				responseType,
			})
			return
		}

		if (skillsEnabled(ctx)) {
			const tools = cachedToolsOf(domia)
			if (tools.length > 0) {
				const target = targets[0]
				domiaBusLogger.info("🛰️ delegating agent inference to peer", {
					target: target.domiaKey,
					tools: tools.length,
				})
				const inference: AgentInferenceType = (messages, toolDefs) =>
					delegateInferenceWithTools(domia.domiaKey, target, {
						messages,
						tools: toolDefs,
						originDomiaKey: originDomiaKey ?? domia.domiaKey,
						interactionId,
					})
				if (
					await tryAgentTurn(ctx, session, tools, inference, {
						key: target.domiaKey,
						model: null,
					})
				)
					return
			}
		}

		if (await tryDelegatedReplyAudio(ctx, session, targets)) return
		await runDelegatedStreamLlm(ctx, session, targets)
	} catch (err) {
		domiaBusLogger.error("STT_DONE: LLM or delegate failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType,
			error: toError(err),
			step: "llm",
			liveVoice: session.liveVoice,
		})
	}
}

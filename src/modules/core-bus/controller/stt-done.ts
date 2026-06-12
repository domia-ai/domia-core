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
	notifyAudioFallback,
	notifyInteractionFailed,
	pipelineDepthFromDomia,
	playStreamedAudio,
	primeStream,
	splitSentences,
	takeMemoryBundle,
	sentenceTuningFromDomia,
} from "../utils"
import {
	getOrCreateInteractionId,
	updateInteraction,
	pipelineElapsed,
} from "@/modules/session-manager"
import {
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	RESPONSE_TYPE_ENUM,
} from "@/db"
import {
	buildPromptContext,
	personaContextFromDomia,
	type RecentTurnType,
} from "@/modules/prompt-context-builder"
import { reflectOnInteraction } from "@/modules/reflection"
import { admitVoiceReply } from "@/modules/voice-admission"
import { runLLM } from "@/modules/llm-engine"
import { ttsAdapterToPcmChunks } from "@/modules/tts-engine"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import {
	streamLlmFromTarget,
	streamReplyAudioFromTarget,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type {
	CoreBusContextType,
	SttDonePayloadType,
	SttFlowSessionType,
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
): void => {
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
		reply,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		alreadyStreamed: true,
	})
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
	})
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
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
	const playbackPromise = playStreamedAudio(
		ctx,
		concatStreams(ttsStreamQueue.iter()),
		{
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			onFirstChunk: () => {
				ttfaMs =
					pipelineElapsed(session.interactionId) ?? Date.now() - startTime
			},
		},
		{ sampleRate: caps.sampleRate, channels: caps.channels },
	)

	let fullReply = ""
	let tokenError: unknown = null
	let playbackError: unknown = null
	let ttsAudioPath: string | undefined
	try {
		for await (const sentence of splitSentences(
			tokens,
			sentenceTuningFromDomia(domia),
		)) {
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
	if (!tokenError) {
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
		ttsAudioPath = await playbackPromise
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
		})
		return true
	}

	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: fullReply,
		ttsEngineUsed: tts.adapter.id,
		llmExecutorKey: executors.llmExecutorKey,
		ttsExecutorKey: domia.domiaKey,
		ttsAudioPath,
		llmMs: llmElapsed,
		ttsMs: Math.max(0, totalElapsed - llmElapsed),
		llmModelUsed: executors.llmModelUsed,
		ttsVoiceUsed: domia.ttsConfig?.voiceName ?? null,
		ttfaMs,
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

	publishStreamedReplyComplete(domia.id, session, fullReply)
	void reflectOnInteraction(
		domia,
		session.transcript,
		fullReply,
		session.interactionId,
		session.originDomiaKey,
	)
	return true
}

const tryLocalFullStreamVoice = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): Promise<boolean> => {
	const { features, domia } = ctx
	const { llm, tts, canSentencePipeline } = features
	if (!session.isVoice || !canSentencePipeline || !llm || !tts) return false
	if (!llm.adapter.runStream) return false

	return pipelineVoiceFromTokens(
		ctx,
		session,
		llm.adapter.runStream(domia, session.promptContext),
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
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
	})
	void reflectOnInteraction(
		ctx.domia,
		session.transcript,
		reply,
		session.interactionId,
		session.originDomiaKey,
	)
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
		const ttsAudioPath = await playStreamedAudio(
			ctx,
			trackedAudio,
			{
				interactionId: session.interactionId,
				originDomiaKey: session.originDomiaKey,
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
		await updateInteraction({
			id: session.interactionId,
			llmPrompt: session.promptContext,
			llmResponse: reply,
			llmExecutorKey: streamed.target?.domiaKey,
			ttsExecutorKey: streamed.target?.domiaKey,
			ttsAudioPath,
			totalMs: pipelineElapsed(session.interactionId),
		})
		publishStreamedReplyComplete(domia.id, session, reply)
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
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
	})
}

export const handleSttDone = async (
	ctx: CoreBusContextType,
	payload: SttDonePayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const domiaId = domia.id
	const { transcript, originDomiaKey, responseType } = payload

	setTraceContext({ interactionId: payload.interactionId, originDomiaKey })
	domiaBusLogger.info(`📝 STT_DONE: ${transcript}`, { domiaId })

	if (payload.alreadyHandled) {
		domiaBusLogger.info(
			`📝 STT_DONE: alreadyHandled — fused voice reply already ran, skipping`,
			{ domiaId, interactionId: payload.interactionId },
		)
		return
	}

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
			})
			const release = await admitVoiceReply(domia).catch((err: unknown) => {
				if (isSemaphoreBusyError(err)) return null
				throw err
			})
			if (!release) {
				notifyInteractionFailed(ctx, {
					interactionId,
					originDomiaKey,
					responseType,
					error: "at capacity — too many concurrent turns",
					step: "capacity",
				})
				return
			}
			try {
				if (await tryLocalFullStreamVoice(ctx, session)) return
				await runLocalSyncLlm(ctx, session)
				return
			} finally {
				release()
			}
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
		})
	}
}

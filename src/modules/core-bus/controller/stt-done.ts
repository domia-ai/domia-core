import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, setTraceContext, toError } from "@/utils"
import {
	AsyncQueue,
	concatStreams,
	DEFAULT_SAMPLE_RATE,
	notifyAudioFallback,
	notifyInteractionFailed,
	playStreamedAudio,
	splitSentences,
} from "../utils"
import {
	getOrCreateInteractionId,
	updateInteraction,
	getRecentTurns,
	getRecentUserMoods,
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
import { getFactStrings } from "@/modules/memory"
import { runLLM } from "@/modules/llm-engine"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import {
	deliverEvent,
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

const tryLocalFullStreamVoice = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): Promise<boolean> => {
	const { features, domia } = ctx
	const { llm, tts, canFullStreamVoice } = features
	if (!session.isVoice || !canFullStreamVoice || !llm || !tts) return false
	if (!llm.adapter.runStream || !tts.adapter.runStream) return false

	const startTime = Date.now()
	const ttsStreamQueue = new AsyncQueue<AsyncIterable<Buffer>>()
	const caps = tts.adapter.capabilities

	const playbackPromise = playStreamedAudio(
		ctx,
		concatStreams(ttsStreamQueue.iter()),
		{
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
		},
		{ sampleRate: caps.sampleRate, channels: caps.channels },
	)

	let fullReply = ""
	let audioError: unknown = null
	let ttsAudioPath: string | undefined
	try {
		const tokens = llm.adapter.runStream(domia, session.promptContext)
		for await (const sentence of splitSentences(tokens)) {
			fullReply += (fullReply.length > 0 ? " " : "") + sentence
			ttsStreamQueue.push(tts.adapter.runStream(domia, sentence))
		}
		ttsStreamQueue.close()
		ttsAudioPath = await playbackPromise
	} catch (err) {
		audioError = err
		ttsStreamQueue.close()
	}

	domiaBusLogger.info(
		`⏱️ LLM+TTS streaming pipeline: ${Date.now() - startTime}ms`,
	)
	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: fullReply,
		ttsEngineUsed: tts.adapter.id,
		ttsAudioPath,
	})

	if (audioError) {
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
			error: toError(audioError),
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
	)
	return true
}

const runLocalSyncLlm = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): Promise<void> => {
	const startTime = Date.now()
	const reply = await runLLM(ctx.domia, session.promptContext)
	domiaBusLogger.info(`⏱️ LLM execution time: ${Date.now() - startTime}ms`)

	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: reply,
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

	try {
		const channels = (streamed.channels === 2 ? 2 : 1) as 1 | 2
		const ttsAudioPath = await playStreamedAudio(
			ctx,
			streamed.audio,
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
			llmResponse: reply,
			ttsEngineUsed: streamed.target?.domiaKey,
			ttsAudioPath,
		})
		publishStreamedReplyComplete(domia.id, session, reply)
		return true
	} catch (err) {
		domiaBusLogger.warn(
			`replyAudio delegation playback failed (${(err as Error)?.message ?? "unknown"}) — falling back`,
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
		return false
	}
}

const tryDelegatedStreamLlm = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
): Promise<boolean> => {
	const streamingTargets = targets.filter(
		(target) => target.streamingCapabilities.llm,
	)
	if (streamingTargets.length === 0) return false

	const { domia } = ctx
	domiaBusLogger.info(
		`📡 streaming LLM delegation (${streamingTargets.length} targets)`,
		{ domiaId: domia.id, interactionId: session.interactionId },
	)
	const streamed = await streamLlmFromTarget(domia.domiaKey, streamingTargets, {
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
		domiaBusLogger.warn(
			`streaming LLM delegation failed (${streamed.error ?? "unknown"}) — falling back to unary`,
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
		return false
	}

	let reply = ""
	for await (const token of streamed.tokens) reply += token
	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: reply,
	})
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
		reply,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
	})
	return true
}

const runDelegatedUnary = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
): Promise<void> => {
	const result = await deliverEvent(ctx.domia.domiaKey, targets, "sttDone", {
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
	})
	if (!result.delivered) {
		throw new Error(`STT_DONE delegation failed: ${result.error ?? "unknown"}`)
	}
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
		emotionSnapshot: domia?.emotionState,
		characterSnapshot: domia?.characterProfile,
	}).catch((err) =>
		domiaBusLogger.error("STT_DONE: snapshot persistence failed", {
			domiaId,
			interactionId,
			err,
		}),
	)

	const recentTurns = await getRecentTurns(domia, interactionId)
	const knownFacts =
		domia.moduleSettings?.factRecall !== false
			? await getFactStrings(domia)
			: []
	const userMoodTrend =
		domia.moduleSettings?.emotionEngine !== false
			? await getRecentUserMoods(domia)
			: []

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
			if (await tryLocalFullStreamVoice(ctx, session)) return
			await runLocalSyncLlm(ctx, session)
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

		if (await tryDelegatedReplyAudio(ctx, session, targets)) return
		if (await tryDelegatedStreamLlm(ctx, session, targets)) return
		await runDelegatedUnary(ctx, session, targets)
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

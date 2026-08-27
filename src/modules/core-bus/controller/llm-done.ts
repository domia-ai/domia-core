import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import {
	domiaBusLogger,
	setTraceContext,
	toError,
	wrapPcmToWav,
	writeWavToTemp,
} from "@/utils"
import {
	DEFAULT_SAMPLE_RATE,
	ensureReplyOrFallback,
	heardReplyOf,
	notifyAudioFallback,
	notifyInteractionFailed,
	playStreamedAudio,
	registerAudioForServing,
	completeInteraction,
	pushInteractionReply,
	getStreamingSink,
	getInteractionRuntime,
	isTurnAborted,
	notifyTurnAborted,
	emitTerminalCompletion,
	createPlaybackLedger,
	registerTurnLedger,
	extractEmotionTags,
	markLadderStage,
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
	runTTS,
	ttsVoiceFromDomia,
	cachedTtsPcmChunks,
} from "@/modules/tts-engine"
import {
	resolveCapabilityDelegations,
	resolveDomiaStreamingCapabilities,
} from "@/modules/capability-resolver"
import {
	deliverEvent,
	streamTtsFromTarget,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import { type DomiaType, getDomiaByDomiaKey } from "@/modules/core"
import { reflectOnInteraction } from "@/modules/reflection"
import type {
	CoreBusContextType,
	LlmDonePayloadType,
	LlmFlowSessionType,
	PlaybackOutcomeType,
} from "../types"

const singleReplyLedger = (
	domia: DomiaType,
	interactionId: string,
	reply: string,
	format: { sampleRate: number; channels: 1 | 2 },
) => {
	const ledger = createPlaybackLedger(format, {
		wordLevelHeard: domia.audioPlaybackConfig?.wordLevelHeardEnabled ?? false,
	})
	registerTurnLedger(interactionId, ledger)
	return {
		ledger,
		wrap: (audio: AsyncIterable<Buffer>) =>
			ledger.wrapSentence(extractEmotionTags(reply).clean, audio),
	}
}

const buildLlmFlowSession = (
	payload: LlmDonePayloadType,
	interactionId: string,
): LlmFlowSessionType => ({
	interactionId,
	speechEndAt: payload.speechEndAt,
	liveVoice: payload.liveVoice,
	reply: payload.reply,
	transcript: payload.transcript,
	originDomiaKey: payload.originDomiaKey,
	responseType: payload.responseType,
})

const reflectIfHeard = (
	ctx: CoreBusContextType,
	session: LlmFlowSessionType,
	heardReply: string,
): void => {
	if (!heardReply || !session.transcript) return
	void reflectOnInteraction(
		ctx.domia,
		session.transcript,
		heardReply,
		session.interactionId,
		session.originDomiaKey,
	)
}

const publishTtsPlaybackComplete = (
	domiaId: string,
	session: LlmFlowSessionType,
	playback: PlaybackOutcomeType,
): void => {
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

const forwardLlmDoneToOrigin = async (
	ctx: CoreBusContextType,
	session: LlmFlowSessionType,
): Promise<void> => {
	const { domia } = ctx
	const { originDomiaKey } = session
	if (!originDomiaKey || originDomiaKey === domia.domiaKey) return

	const originDomia = await getDomiaByDomiaKey(originDomiaKey)
	if (!originDomia) return

	await deliverEvent(
		domia.domiaKey,
		[
			{
				domiaKey: originDomia.domiaKey,
				domiaId: originDomia.id,
				localIp: originDomia.localIp,
				grpcPort: originDomia.grpcPort,
				source: "explicit",
				streamingCapabilities: resolveDomiaStreamingCapabilities(originDomia),
			},
		],
		"llmDone",
		{
			reply: session.reply,
			interactionId: session.interactionId,
			originDomiaKey,
			responseType: session.responseType,
		},
	)
}

const tryLocalStreamingTtsPlayback = async (
	ctx: CoreBusContextType,
	session: LlmFlowSessionType,
): Promise<boolean> => {
	const { tts, canPlayback } = ctx.features
	const hasSink = getStreamingSink(session.interactionId) !== undefined
	const delivery = getInteractionRuntime(session.interactionId)?.delivery
		.audioDelivery
	if (
		delivery === "none" ||
		(!canPlayback && !hasSink) ||
		tts?.adapter.capabilities.streaming !== true ||
		!tts.adapter.runStream
	)
		return false

	const { domia } = ctx
	const caps = tts.adapter.capabilities
	let playback: PlaybackOutcomeType
	let ttfaMs: number | undefined
	let perceivedTtfaMs: number | undefined
	const ttsStart = Date.now()
	markLadderStage(session.interactionId, "ttsFirstUnitAt", ttsStart)
	try {
		const single = singleReplyLedger(
			domia,
			session.interactionId,
			session.reply,
			{
				sampleRate: caps.sampleRate,
				channels: caps.channels,
			},
		)
		playback = await playStreamedAudio(
			ctx,
			single.wrap(cachedTtsPcmChunks(domia, tts.adapter, session.reply)),
			{
				interactionId: session.interactionId,
				originDomiaKey: session.originDomiaKey,
				ledger: single.ledger,
				aborted: () => isTurnAborted(domia.id, session.interactionId),
				onFirstChunk: () => {
					ttfaMs = pipelineElapsed(session.interactionId) ?? undefined
					if (session.speechEndAt) {
						perceivedTtfaMs = Date.now() - session.speechEndAt
					}
				},
			},
			{ sampleRate: caps.sampleRate, channels: caps.channels },
		)
	} catch (err) {
		notifyAudioFallback(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			reason: "tts_failed",
			error: toError(err),
			reply: session.reply,
		})
		return true
	}

	const heardReply = heardReplyOf(session.reply, playback)
	await updateInteraction({
		id: session.interactionId,
		heardReply,
		ttsEngineUsed: tts.adapter.id,
		ttsExecutorKey: domia.domiaKey,
		ttsAudioPath: playback.filePath,
		ttsMs: Date.now() - ttsStart,
		ttsVoiceUsed: domia.ttsConfig?.voiceName ?? null,
		ttfaMs,
		perceivedTtfaMs,
		totalMs: pipelineElapsed(session.interactionId),
	})
	publishTtsPlaybackComplete(domia.id, session, playback)
	reflectIfHeard(ctx, session, heardReply)
	return true
}

const runLocalSyncTts = async (
	ctx: CoreBusContextType,
	session: LlmFlowSessionType,
): Promise<void> => {
	const { domia } = ctx
	let response: Awaited<ReturnType<typeof runTTS>>
	const ttsStart = Date.now()
	markLadderStage(session.interactionId, "ttsFirstUnitAt", ttsStart)
	try {
		response = await runTTS(domia, session.reply)
	} catch (err) {
		notifyAudioFallback(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			reason: "tts_failed",
			error: toError(err),
			reply: session.reply,
		})
		return
	}

	const filePath = response.filePath
	await updateInteraction({
		id: session.interactionId,
		ttsEngineUsed: response.engineUsed,
		ttsExecutorKey: domia.domiaKey,
		ttsAudioPath: filePath,
		ttsMs: Date.now() - ttsStart,
		ttsVoiceUsed: domia.ttsConfig?.voiceName ?? null,
		totalMs: pipelineElapsed(session.interactionId),
	})
	registerAudioForServing(session.interactionId, filePath)
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
		filePath,
		reply: session.reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		liveVoice: session.liveVoice,
	})
}

const runDelegatedStreamingTts = async (
	ctx: CoreBusContextType,
	session: LlmFlowSessionType,
	targets: DeliverEventTarget[],
): Promise<void> => {
	const orderedTargets = [...targets].sort(
		(a, b) =>
			Number(b.streamingCapabilities.tts) - Number(a.streamingCapabilities.tts),
	)

	const { domia } = ctx
	domiaBusLogger.info(
		`📡 streaming TTS delegation (${orderedTargets.length} targets)`,
		{ domiaId: domia.id, interactionId: session.interactionId },
	)
	const ownVoice = ttsVoiceFromDomia(domia)
	const streamed = await streamTtsFromTarget(domia.domiaKey, orderedTargets, {
		reply: session.reply,
		originDomiaKey: session.originDomiaKey,
		interactionId: session.interactionId,
		ttsVoice: ownVoice ?? undefined,
	})

	if (!streamed.delivered || !streamed.audio) {
		throw new Error(
			`LLM_DONE→TTS delegation failed: ${streamed.error ?? "unknown"} (tried ${streamed.attemptedTargets})`,
		)
	}

	const channels = (streamed.channels === 2 ? 2 : 1) as 1 | 2
	const sampleRate = streamed.sampleRate ?? DEFAULT_SAMPLE_RATE

	if (!ctx.features.canPlayback && !getStreamingSink(session.interactionId)) {
		const chunks: Buffer[] = []
		for await (const chunk of streamed.audio) chunks.push(chunk)
		const wav = wrapPcmToWav(Buffer.concat(chunks), sampleRate, channels, 16)
		const ttsAudioPath = await writeWavToTemp(wav, session.interactionId, "tts")
		registerAudioForServing(session.interactionId, ttsAudioPath)
		await updateInteraction({
			id: session.interactionId,
			ttsExecutorKey: streamed.target?.domiaKey,
			ttsAudioPath,
		})
		publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			filePath: ttsAudioPath,
		})
		return
	}

	let ttfaMs: number | undefined
	let perceivedTtfaMs: number | undefined
	try {
		const single = singleReplyLedger(
			domia,
			session.interactionId,
			session.reply,
			{
				sampleRate,
				channels,
			},
		)
		const playback = await playStreamedAudio(
			ctx,
			single.wrap(streamed.audio),
			{
				interactionId: session.interactionId,
				originDomiaKey: session.originDomiaKey,
				ledger: single.ledger,
				aborted: () => isTurnAborted(domia.id, session.interactionId),
				onFirstChunk: () => {
					ttfaMs = pipelineElapsed(session.interactionId) ?? undefined
					if (session.speechEndAt) {
						perceivedTtfaMs = Date.now() - session.speechEndAt
					}
				},
			},
			{ sampleRate, channels },
		)
		const heardReply = heardReplyOf(session.reply, playback)
		await updateInteraction({
			id: session.interactionId,
			heardReply,
			ttsExecutorKey: streamed.target?.domiaKey,
			ttsAudioPath: playback.filePath,
			ttfaMs,
			perceivedTtfaMs,
			totalMs: pipelineElapsed(session.interactionId),
		})
		publishTtsPlaybackComplete(domia.id, session, playback)
		reflectIfHeard(ctx, session, heardReply)
	} catch (err) {
		notifyAudioFallback(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			reason: "tts_failed",
			error: toError(err),
			reply: session.reply,
		})
		return
	}
}

export const deliverReply = async (
	ctx: CoreBusContextType,
	payload: LlmDonePayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const domiaId = domia.id
	const { reply, originDomiaKey, responseType } = payload

	domiaBusLogger.info(`🗣️ LLM_DONE: ${reply}`, { domiaId })

	if (payload.interactionId && reply) {
		pushInteractionReply(payload.interactionId, reply)
	}

	if (payload.alreadyStreamed) {
		domiaBusLogger.info(
			`🗣️ LLM_DONE: alreadyStreamed flag set — handleSttDone already ran TTS+playback, skipping`,
			{ domiaId, interactionId: payload.interactionId },
		)
		return
	}

	if (payload.interactionId && isTurnAborted(domiaId, payload.interactionId)) {
		await notifyTurnAborted(
			domiaId,
			payload.interactionId,
			originDomiaKey,
			reply,
		)
		return
	}

	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
			responseType:
				responseType === RESPONSE_TYPE_ENUM.VOICE
					? RESPONSE_TYPE_ENUM.VOICE
					: RESPONSE_TYPE_ENUM.TEXT,
		},
	)
	if (!interactionId) return
	setTraceContext({ interactionId, originDomiaKey })

	const ensured = ensureReplyOrFallback(reply, domia.characterProfile?.language)
	if (ensured.usedFallback) {
		domiaBusLogger.warn("LLM_DONE: empty reply — using fallback message", {
			domiaId,
			interactionId,
		})
	}
	const session = buildLlmFlowSession(
		{ ...payload, reply: ensured.reply },
		interactionId,
	)

	if (ensured.usedFallback) pushInteractionReply(interactionId, ensured.reply)
	if (responseType === RESPONSE_TYPE_ENUM.TEXT) {
		await emitTerminalCompletion(interactionId, originDomiaKey ?? "", {
			status: "ok",
		})
		completeInteraction(interactionId, {
			result: { transcript: payload.transcript ?? "", reply: ensured.reply },
		})
		await forwardLlmDoneToOrigin(ctx, session)
		return
	}

	try {
		if (features.canRunTts) {
			if (await tryLocalStreamingTtsPlayback(ctx, session)) return
			await runLocalSyncTts(ctx, session)
			return
		}

		const targets = await resolveCapabilityDelegations(
			domia,
			CAPABILITY_ENUM.TTS,
		)
		if (targets.length === 0) {
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
				capability: CAPABILITY_ENUM.TTS,
				interactionId,
				originDomiaKey,
				responseType,
			})
			return
		}

		await runDelegatedStreamingTts(ctx, session, targets)
	} catch (err) {
		domiaBusLogger.error("LLM_DONE: TTS or delegate failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType,
			error: toError(err),
			step: "tts",
			liveVoice: session.liveVoice,
		})
	}
}

export const handleLlmDone = deliverReply

import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, setTraceContext, toError } from "@/utils"
import {
	DEFAULT_SAMPLE_RATE,
	notifyAudioFallback,
	notifyInteractionFailed,
	playStreamedAudio,
	registerAudioForServing,
	resolvePending,
} from "../utils"
import {
	getOrCreateInteractionId,
	updateInteraction,
} from "@/modules/session-manager"
import {
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	RESPONSE_TYPE_ENUM,
} from "@/db"
import { runTTS, ttsVoiceFromDomia } from "@/modules/tts-engine"
import {
	resolveCapabilityDelegations,
	resolveDomiaStreamingCapabilities,
} from "@/modules/capability-resolver"
import {
	deliverEvent,
	streamTtsFromTarget,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import { getDomiaByDomiaKey } from "@/modules/core"
import type {
	CoreBusContextType,
	LlmDonePayloadType,
	LlmFlowSessionType,
} from "../types"

const buildLlmFlowSession = (
	payload: LlmDonePayloadType,
	interactionId: string,
): LlmFlowSessionType => ({
	interactionId,
	reply: payload.reply,
	originDomiaKey: payload.originDomiaKey,
	responseType: payload.responseType,
})

const publishTtsPlaybackComplete = (
	domiaId: string,
	session: LlmFlowSessionType,
): void => {
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
	})
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
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
	const { tts, canStreamTts, canPlayback } = ctx.features
	if (!canStreamTts || !canPlayback || !tts?.adapter.runStream) return false

	const { domia } = ctx
	const caps = tts.adapter.capabilities
	let ttsAudioPath: string | undefined
	try {
		ttsAudioPath = await playStreamedAudio(
			ctx,
			tts.adapter.runStream(domia, session.reply),
			{
				interactionId: session.interactionId,
				originDomiaKey: session.originDomiaKey,
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

	await updateInteraction({
		id: session.interactionId,
		ttsEngineUsed: tts.adapter.id,
		ttsAudioPath,
	})
	publishTtsPlaybackComplete(domia.id, session)
	return true
}

const runLocalSyncTts = async (
	ctx: CoreBusContextType,
	session: LlmFlowSessionType,
): Promise<void> => {
	const { domia } = ctx
	let response: Awaited<ReturnType<typeof runTTS>>
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
		ttsAudioPath: filePath,
	})
	registerAudioForServing(session.interactionId, filePath)
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
		filePath,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
	})
}

const tryDelegatedStreamingTtsPlayback = async (
	ctx: CoreBusContextType,
	session: LlmFlowSessionType,
	targets: DeliverEventTarget[],
): Promise<boolean> => {
	if (!ctx.features.canPlayback) return false
	const streamingTargets = targets.filter(
		(target) => target.streamingCapabilities.tts,
	)
	if (streamingTargets.length === 0) return false

	const { domia } = ctx
	domiaBusLogger.info(
		`📡 streaming TTS delegation (${streamingTargets.length} targets)`,
		{ domiaId: domia.id, interactionId: session.interactionId },
	)
	const ownVoice = ttsVoiceFromDomia(domia)
	const streamed = await streamTtsFromTarget(domia.domiaKey, streamingTargets, {
		reply: session.reply,
		originDomiaKey: session.originDomiaKey,
		interactionId: session.interactionId,
		ttsVoiceJson: ownVoice ? JSON.stringify(ownVoice) : undefined,
	})

	if (!streamed.delivered || !streamed.audio) {
		domiaBusLogger.warn(
			`streaming TTS delegation failed (${streamed.error ?? "unknown"}) — falling back to unary`,
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
		await updateInteraction({
			id: session.interactionId,
			ttsEngineUsed: streamed.target?.domiaKey,
			ttsAudioPath,
		})
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
	publishTtsPlaybackComplete(domia.id, session)
	return true
}

const runDelegatedTtsUnary = async (
	ctx: CoreBusContextType,
	session: LlmFlowSessionType,
	targets: DeliverEventTarget[],
): Promise<void> => {
	const result = await deliverEvent(ctx.domia.domiaKey, targets, "llmDone", {
		reply: session.reply,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
	})
	if (!result.delivered) {
		throw new Error(
			`LLM_DONE→TTS delegation failed: ${result.error ?? "unknown"}`,
		)
	}
}

export const handleLlmDone = async (
	ctx: CoreBusContextType,
	payload: LlmDonePayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const domiaId = domia.id
	const { reply, originDomiaKey, responseType } = payload

	setTraceContext({ interactionId: payload.interactionId, originDomiaKey })
	domiaBusLogger.info(`🗣️ LLM_DONE: ${reply}`, { domiaId })

	if (payload.alreadyStreamed) {
		domiaBusLogger.info(
			`🗣️ LLM_DONE: alreadyStreamed flag set — handleSttDone already ran TTS+playback, skipping`,
			{ domiaId, interactionId: payload.interactionId },
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

	const session = buildLlmFlowSession(payload, interactionId)

	if (responseType === RESPONSE_TYPE_ENUM.TEXT) {
		resolvePending(interactionId, reply)
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

		if (await tryDelegatedStreamingTtsPlayback(ctx, session, targets)) return
		await runDelegatedTtsUnary(ctx, session, targets)
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
		})
	}
}

import {
	subscribeToDomiaBus,
	clearDomiaBusSubscribers,
	DOMIA_EVENT_BUS_ENUM,
} from "@/buses"
import {
	domiaBusLogger,
	ensureTraceId,
	getTraceContext,
	runWithTraceContext,
} from "@/utils"
import type { TraceContextType } from "@/utils"
import { resolveLiveDomia } from "@/setups/live-domia"
import { getInteractionById } from "@/modules/session-manager"
import {
	handleWakeDetected,
	handleAudioReady,
	handleSttDone,
	handleLlmDone,
	handleTtsDone,
	handlePlaybackStarted,
	handlePlaybackFinished,
	handleAudioError,
	handleCapabilityMissing,
	handleInteractionFailed,
	resolveCoreBusFeatures,
	getInteractionRuntime,
	type CoreBusContextType,
} from "@/modules/core-bus"
import type { CoreBusArgsType } from "./types"

const DB_TRACE_FALLBACK_EVENTS = new Set<DOMIA_EVENT_BUS_ENUM>([
	DOMIA_EVENT_BUS_ENUM.LLM_DONE,
	DOMIA_EVENT_BUS_ENUM.TTS_DONE,
	DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED,
])

export const setupCoreBus = ({
	domia,
	runtimeCapabilities,
}: CoreBusArgsType) => {
	const domiaId = domia.id

	domiaBusLogger.info(
		`🔗 Subscribing to bus events for DOMIA ${domia.name} (${domiaId})`,
	)

	const features = resolveCoreBusFeatures(domia, runtimeCapabilities)
	domiaBusLogger.info(`🔧 Resolved features`, {
		domiaId,
		stt: features.stt?.adapter.id ?? null,
		tts: features.tts?.adapter.id ?? null,
		llm: features.llm?.adapter.id ?? null,
		canStreamStt: features.canStreamStt,
		canStreamLlm: features.canStreamLlm,
		canStreamTts: features.canStreamTts,
		canSentencePipeline: features.canSentencePipeline,
	})

	const liveCtx = async (): Promise<CoreBusContextType> =>
		resolveLiveDomia(domia, runtimeCapabilities)

	const knownTraceId = async (
		interactionId: string,
		allowDbLookup: boolean,
	): Promise<string | undefined> => {
		const fromRuntime = getInteractionRuntime(interactionId)?.envelope.traceId
		if (fromRuntime) return fromRuntime
		const ambient = getTraceContext()?.traceId
		if (ambient) return ambient
		if (!allowDbLookup) return undefined
		const row = await getInteractionById(interactionId).catch(() => undefined)
		return row?.traceId ?? undefined
	}

	const traceFromPayload = async (
		payload: unknown,
		allowDbLookup: boolean,
	): Promise<TraceContextType> => {
		const p = (payload ?? {}) as TraceContextType
		const inherited =
			p.traceId ??
			(p.interactionId
				? await knownTraceId(p.interactionId, allowDbLookup)
				: undefined)
		return {
			interactionId: p.interactionId,
			originDomiaKey: p.originDomiaKey,
			traceId: ensureTraceId(inherited),
		}
	}

	const onEvent =
		<P>(
			event: DOMIA_EVENT_BUS_ENUM,
			handler: (ctx: CoreBusContextType, payload: P) => unknown,
		) =>
		(payload: P): void => {
			const allowDbLookup = DB_TRACE_FALLBACK_EVENTS.has(event)
			void (async () => {
				const trace = await traceFromPayload(payload, allowDbLookup)
				await runWithTraceContext(trace, async () => {
					try {
						await handler(await liveCtx(), payload)
					} catch (err) {
						domiaBusLogger.error("core-bus event handler failed", { err })
					}
				})
			})().catch((err: unknown) => {
				domiaBusLogger.error("core-bus event dispatch failed", { err })
			})
		}

	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED,
		onEvent(DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED, handleWakeDetected),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.AUDIO_READY,
		onEvent(DOMIA_EVENT_BUS_ENUM.AUDIO_READY, handleAudioReady),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.STT_DONE,
		onEvent(DOMIA_EVENT_BUS_ENUM.STT_DONE, handleSttDone),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.LLM_DONE,
		onEvent(DOMIA_EVENT_BUS_ENUM.LLM_DONE, handleLlmDone),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.TTS_DONE,
		onEvent(DOMIA_EVENT_BUS_ENUM.TTS_DONE, handleTtsDone),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED,
		onEvent(DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED, handlePlaybackStarted),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED,
		onEvent(DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, handlePlaybackFinished),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR,
		onEvent(DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, handleAudioError),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING,
		onEvent(DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, handleCapabilityMissing),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
		onEvent(DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED, handleInteractionFailed),
	)
}

export const teardownCoreBus = (domiaId: string): void => {
	for (const event of Object.values(DOMIA_EVENT_BUS_ENUM))
		clearDomiaBusSubscribers(domiaId, event)
}

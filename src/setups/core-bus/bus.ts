import {
	subscribeToDomiaBus,
	clearDomiaBusSubscribers,
	DOMIA_EVENT_BUS_ENUM,
} from "@/buses"
import { domiaBusLogger, runWithTraceContext } from "@/utils"
import type { TraceContextType } from "@/utils"
import { resolveLiveDomia } from "@/setups/live-domia"
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
	type CoreBusContextType,
} from "@/modules/core-bus"
import type { CoreBusArgsType } from "./types"

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

	const traceFromPayload = (payload: unknown): TraceContextType => {
		const p = (payload ?? {}) as TraceContextType
		return {
			interactionId: p.interactionId,
			originDomiaKey: p.originDomiaKey,
			traceId: p.traceId,
		}
	}

	const onEvent =
		<P>(handler: (ctx: CoreBusContextType, payload: P) => unknown) =>
		async (payload: P): Promise<void> =>
			runWithTraceContext(traceFromPayload(payload), async () => {
				try {
					await handler(await liveCtx(), payload)
				} catch (err) {
					domiaBusLogger.error("core-bus event handler failed", { err })
				}
			})

	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED,
		onEvent(handleWakeDetected),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.AUDIO_READY,
		onEvent(handleAudioReady),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.STT_DONE,
		onEvent(handleSttDone),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.LLM_DONE,
		onEvent(handleLlmDone),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.TTS_DONE,
		onEvent(handleTtsDone),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED,
		onEvent(handlePlaybackStarted),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED,
		onEvent(handlePlaybackFinished),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR,
		onEvent(handleAudioError),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING,
		onEvent(handleCapabilityMissing),
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
		onEvent(handleInteractionFailed),
	)
}

export const teardownCoreBus = (domiaId: string): void => {
	for (const event of Object.values(DOMIA_EVENT_BUS_ENUM))
		clearDomiaBusSubscribers(domiaId, event)
}

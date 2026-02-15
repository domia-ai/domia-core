import { subscribeToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger } from "@/utils"
import {
	handleWakeDetected,
	handleAudioReady,
	handleSttDone,
	handleLlmDone,
	handleTtsDone,
	handleAudioError,
	handleCapabilityMissing,
	handleInteractionFailed,
} from "@/modules/core-bus"
import type { CoreBusArgsType } from "./types"

export const setupCoreBus = ({
	domia,
	runtimeCapabilities,
	mqttClient,
}: CoreBusArgsType) => {
	const domiaId = domia.id

	domiaBusLogger.info(
		`🔗 Subscribing to bus events for DOMIA ${domia.name} (${domiaId})`,
	)

	const ctx = { domia, runtimeCapabilities, mqttClient }

	subscribeToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED, () =>
		handleWakeDetected(ctx),
	)

	subscribeToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, (payload) =>
		handleAudioReady(ctx, payload),
	)

	subscribeToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, (payload) =>
		handleSttDone(ctx, payload),
	)

	subscribeToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, (payload) =>
		handleLlmDone(ctx, payload),
	)

	subscribeToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, (payload) =>
		handleTtsDone(ctx, payload),
	)

	subscribeToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, (payload) =>
		handleAudioError(ctx, payload),
	)

	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING,
		(payload) => handleCapabilityMissing(ctx, payload),
	)

	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
		(payload) => handleInteractionFailed(ctx, payload),
	)
}

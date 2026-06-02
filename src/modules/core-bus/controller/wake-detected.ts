import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, setTraceContext, toError } from "@/utils"
import { startAudioRecording, startAudioStream } from "@/modules/audio-capture"
import {
	getOrCreateInteractionId,
	updateInteraction,
} from "@/modules/session-manager"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import type { CoreBusContextType } from "../types"

const recordingInProgress = new Set<string>()

export const handleWakeDetected = async (
	ctx: CoreBusContextType,
): Promise<void> => {
	const { domia, features } = ctx
	const { capabilities, stt, canStreamStt } = features
	const domiaId = domia.id

	domiaBusLogger.info(`🎧 WAKE_DETECTED received`, { domiaId })
	if (!capabilities.record) return

	if (recordingInProgress.has(domiaId)) {
		domiaBusLogger.warn(
			`🚫 wake_detected ignored — recording already in progress for ${domiaId}`,
		)
		return
	}
	recordingInProgress.add(domiaId)

	try {
		if (canStreamStt && stt?.adapter.runStream) {
			const interactionId = await getOrCreateInteractionId(domia, undefined, {
				inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
				responseType: RESPONSE_TYPE_ENUM.VOICE,
			})
			if (!interactionId) return
			setTraceContext({ interactionId, originDomiaKey: domia.domiaKey })

			domiaBusLogger.info(
				`🎙️ streaming STT path: capturing live audio chunks`,
				{ domiaId, interactionId },
			)
			const { chunks, filePathPromise } = startAudioStream(domia)
			const transcript = await stt.adapter.runStream(domia, chunks)

			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
				transcript,
				interactionId,
				originDomiaKey: domia.domiaKey,
			})

			void filePathPromise
				.then((filePath) =>
					updateInteraction({
						id: interactionId,
						inputAudioPath: filePath,
						sttResult: transcript,
					}),
				)
				.catch((err) =>
					domiaBusLogger.error("WAKE_DETECTED: audio persistence failed", {
						domiaId,
						interactionId,
						err,
					}),
				)
			return
		}

		const filePath = await startAudioRecording(domia)
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath,
			originDomiaKey: domia.domiaKey,
		})
	} catch (err) {
		domiaBusLogger.error("WAKE_DETECTED / recording failed", { domiaId, err })
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, {
			error: toError(err),
		})
	} finally {
		recordingInProgress.delete(domiaId)
	}
}

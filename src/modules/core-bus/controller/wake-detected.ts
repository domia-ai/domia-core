import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, setTraceContext, toError } from "@/utils"
import { startAudioRecording, startAudioStream } from "@/modules/audio-capture"
import { hasActivePlayback, stopActivePlayback } from "@/modules/audio-playback"
import { playFeedbackSound } from "@/modules/feedback-sounds"
import { admitVoiceReply } from "@/modules/voice-admission"
import { isSemaphoreBusyError, onceFn } from "@/utils"
import {
	getOrCreateInteractionId,
	markPipelineStart,
	updateInteraction,
} from "@/modules/session-manager"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import {
	prefetchMemoryBundle,
	tryBeginRecording,
	endRecording,
	abortActiveTurn,
} from "../utils"
import { runSpeculativeTurn } from "./speculative-turn"
import type { CoreBusContextType } from "../types"

export const handleWakeDetected = async (
	ctx: CoreBusContextType,
): Promise<void> => {
	const { domia, features } = ctx
	const { capabilities, stt, canStreamStt } = features
	const domiaId = domia.id

	domiaBusLogger.info(`🎧 WAKE_DETECTED received`, { domiaId })
	if (!capabilities.record) return

	if (
		hasActivePlayback(domiaId) &&
		!(domia.wakeWordConfig?.bargeInEnabled ?? true)
	) {
		domiaBusLogger.info(
			`🚫 wake_detected ignored — playback active and barge-in disabled`,
			{ domiaId },
		)
		return
	}

	if (!tryBeginRecording(domiaId)) {
		domiaBusLogger.warn(
			`🚫 wake_detected ignored — recording already in progress for ${domiaId}`,
		)
		return
	}

	if (abortActiveTurn(domiaId, "wake-bargein")) {
		domiaBusLogger.info(`🛑 barge-in: in-flight turn aborted by wake word`, {
			domiaId,
		})
	} else if (stopActivePlayback(domiaId)) {
		domiaBusLogger.info(`🛑 barge-in: playback interrupted by wake word`, {
			domiaId,
		})
	}

	playFeedbackSound(domia, "ack")

	try {
		const speculativeMs = domia.wakeWordConfig?.speculativeSilenceMs ?? 0
		const localSpeculation =
			features.canRunLlm &&
			features.canSentencePipeline &&
			Boolean(features.llm?.adapter.runStream)
		const skillsMayIntercept =
			domia.moduleSettings?.skillsEngine === true &&
			(domia.skillProviders ?? []).some(
				(p) => p.isActive && (p.toolsCache?.length ?? 0) > 0,
			)
		if (
			speculativeMs > 0 &&
			!skillsMayIntercept &&
			stt?.adapter.runPcm &&
			(localSpeculation || !features.canRunLlm)
		) {
			const admitted = await admitVoiceReply(domia).catch((err: unknown) => {
				if (isSemaphoreBusyError(err)) return null
				throw err
			})
			if (admitted) {
				const release = onceFn(admitted)
				try {
					const interactionId = await getOrCreateInteractionId(
						domia,
						undefined,
						{
							inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
							responseType: RESPONSE_TYPE_ENUM.VOICE,
						},
					)
					if (!interactionId) {
						release()
						return
					}
					prefetchMemoryBundle(domia, interactionId)
					setTraceContext({ interactionId, originDomiaKey: domia.domiaKey })
					await runSpeculativeTurn(ctx, { interactionId, release })
				} catch (err) {
					release()
					throw err
				}
				return
			}
			domiaBusLogger.warn(
				`🔮 speculation skipped — at voice capacity, falling back`,
				{ domiaId },
			)
		}

		if (canStreamStt && stt?.adapter.runStream) {
			const interactionId = await getOrCreateInteractionId(domia, undefined, {
				inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
				responseType: RESPONSE_TYPE_ENUM.VOICE,
			})
			if (!interactionId) return
			prefetchMemoryBundle(domia, interactionId)
			setTraceContext({ interactionId, originDomiaKey: domia.domiaKey })

			domiaBusLogger.info(
				`🎙️ streaming STT path: capturing live audio chunks`,
				{ domiaId, interactionId },
			)
			const { chunks, filePathPromise, speechEndAt } = startAudioStream(domia)
			const transcript = await stt.adapter.runStream(domia, chunks)

			markPipelineStart(interactionId)
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
				transcript,
				interactionId,
				originDomiaKey: domia.domiaKey,
				speechEndAt: speechEndAt() ?? undefined,
				liveVoice: true,
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

		const interactionId = await getOrCreateInteractionId(domia, undefined, {
			inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
		})
		if (interactionId) prefetchMemoryBundle(domia, interactionId)
		const filePath = await startAudioRecording(domia)
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath,
			interactionId: interactionId ?? undefined,
			originDomiaKey: domia.domiaKey,
			liveVoice: true,
		})
	} catch (err) {
		domiaBusLogger.error("WAKE_DETECTED / recording failed", { domiaId, err })
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, {
			error: toError(err),
		})
	} finally {
		endRecording(domiaId)
	}
}

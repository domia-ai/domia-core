import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, setTraceContext, toError } from "@/utils"
import {
	observeBargeIn,
	startAudioRecording,
	startAudioStream,
} from "@/modules/audio-capture"
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
	beginInteraction,
	failInteraction,
	prefetchMemoryBundle,
	tryBeginRecording,
	endRecording,
	abortActiveTurn,
	getIntercom,
	skillsMayIntercept,
} from "../utils"
import { runSpeculativeTurn } from "./speculative-turn"
import type { CoreBusContextType } from "../types"

export const handleWakeDetected = async (
	ctx: CoreBusContextType,
): Promise<void> => {
	const { domia, features } = ctx
	const { capabilities, stt, canStreamStt } = features
	const domiaId = domia.id

	if (getIntercom(domia.domiaKey)) {
		domiaBusLogger.info(`🎙️ wake ignored — intercom active`, { domiaId })
		return
	}

	const wakeAt = Date.now()
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

	if (domia.wakeWordConfig) observeBargeIn(domiaId, domia.wakeWordConfig)
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

	let runtimeInteractionId: string | null = null
	try {
		const speculativeMs = domia.wakeWordConfig?.speculativeSilenceMs ?? 0
		const localSpeculation =
			features.canRunLlm &&
			features.canSentencePipeline &&
			Boolean(features.llm?.adapter.runStream)
		const speculationBlockedBySkills =
			skillsMayIntercept(domia) &&
			domia.wakeWordConfig?.speculateWithSkills !== true
		if (
			speculativeMs > 0 &&
			!speculationBlockedBySkills &&
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
					await runSpeculativeTurn(ctx, {
						interactionId,
						release,
						replaySinceTs: wakeAt,
					})
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
			const handle = await beginInteraction(
				domia,
				{
					input: { kind: "audio_stream" },
					requestedOutput: { kind: "voice" },
					source: "local",
				},
				{ audioDelivery: "local-playback", prefetch: true },
			)
			if (!handle) return
			const { interactionId } = handle
			runtimeInteractionId = interactionId
			setTraceContext({ interactionId, originDomiaKey: domia.domiaKey })

			domiaBusLogger.info(
				`🎙️ streaming STT path: capturing live audio chunks`,
				{ domiaId, interactionId },
			)
			const {
				chunks,
				filePathPromise,
				speechEndAt,
				endpointObservedMs,
				debounceMs,
			} = startAudioStream(domia)
			const transcript = await stt.adapter.runStream(domia, chunks)

			markPipelineStart(interactionId)
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
				transcript,
				interactionId,
				originDomiaKey: domia.domiaKey,
				speechEndAt: speechEndAt() ?? undefined,
				endpointDelayMs: endpointObservedMs() ?? undefined,
				endpointDebounceMs: debounceMs,
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

		const handle = await beginInteraction(
			domia,
			{
				input: { kind: "audio_stream" },
				requestedOutput: { kind: "voice" },
				source: "local",
			},
			{ audioDelivery: "local-playback", prefetch: true },
		)
		runtimeInteractionId = handle?.interactionId ?? null
		const filePath = await startAudioRecording(domia)
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath,
			interactionId: handle?.interactionId ?? undefined,
			originDomiaKey: domia.domiaKey,
			liveVoice: true,
		})
	} catch (err) {
		domiaBusLogger.error("WAKE_DETECTED / recording failed", { domiaId, err })
		if (runtimeInteractionId)
			failInteraction(runtimeInteractionId, toError(err).message, "recording")
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, {
			error: toError(err),
		})
	} finally {
		endRecording(domiaId)
	}
}

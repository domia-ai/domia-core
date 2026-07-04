import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import {
	domiaBusLogger,
	isSemaphoreBusyError,
	onceFn,
	setTraceContext,
	toError,
} from "@/utils"
import {
	startFollowUpRecording,
	startFollowUpSpeculativeCapture,
} from "@/modules/audio-capture"
import { playFeedbackSound } from "@/modules/feedback-sounds"
import { admitVoiceReply } from "@/modules/voice-admission"
import { getOrCreateInteractionId } from "@/modules/session-manager"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import { runSpeculativeTurn } from "./speculative-turn"
import {
	prefetchMemoryBundle,
	tryBeginRecording,
	endRecording,
	completeInteraction,
	pushInteractionFirstAudio,
} from "../utils"
import type {
	CoreBusContextType,
	PlaybackFinishedPayloadType,
	PlaybackStartedPayloadType,
} from "../types"

export const handlePlaybackStarted = (
	_ctx: CoreBusContextType,
	payload: PlaybackStartedPayloadType,
): void => {
	if (payload?.interactionId) pushInteractionFirstAudio(payload.interactionId)
}

const speculationEligible = (ctx: CoreBusContextType): boolean => {
	const { domia, features } = ctx
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
	return (
		speculativeMs > 0 &&
		!skillsMayIntercept &&
		Boolean(features.stt?.adapter.runPcm) &&
		(localSpeculation || !features.canRunLlm)
	)
}

const runFollowUpSpeculative = async (
	ctx: CoreBusContextType,
): Promise<void> => {
	const { domia } = ctx
	const domiaId = domia.id
	const fu = startFollowUpSpeculativeCapture(domia)
	const spoke = await fu.speechStarted
	if (!spoke) {
		playFeedbackSound(domia, "done")
		return
	}
	const admitted = await admitVoiceReply(domia).catch((err: unknown) => {
		if (isSemaphoreBusyError(err)) return null
		fu.stop()
		throw err
	})
	if (!admitted) {
		domiaBusLogger.warn(
			`🔮 follow-up speculation skipped — at voice capacity, consuming as batch`,
			{ domiaId },
		)
		const capture = fu.attach({
			onSpeculate: () => undefined,
			onResume: () => undefined,
		})
		const filePath = await capture.filePathPromise
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath,
			originDomiaKey: domia.domiaKey,
			speechEndAt: capture.speechEndAt() ?? undefined,
			liveVoice: true,
		})
		return
	}
	const release = onceFn(admitted)
	try {
		const interactionId = await getOrCreateInteractionId(domia, undefined, {
			inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
		})
		if (!interactionId) {
			release()
			fu.stop()
			return
		}
		prefetchMemoryBundle(domia, interactionId)
		setTraceContext({ interactionId, originDomiaKey: domia.domiaKey })
		domiaBusLogger.info(`🔮 follow-up speculative turn`, {
			domiaId,
			interactionId,
		})
		await runSpeculativeTurn(ctx, {
			interactionId,
			release,
			captureFactory: fu.attach,
		})
	} catch (err) {
		release()
		throw err
	}
}

export const handlePlaybackFinished = async (
	ctx: CoreBusContextType,
	payload: PlaybackFinishedPayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const { capabilities } = features
	const domiaId = domia.id

	if (payload?.interactionId) {
		completeInteraction(payload.interactionId, {
			interrupted: payload.status !== "completed",
		})
	}

	if (payload?.status !== "completed" || payload?.playedLocally !== true) return
	if (payload?.liveVoice !== true) return

	const windowMs = domia.wakeWordConfig?.followUpWindowMs ?? 0
	const willFollowUp =
		capabilities.record && capabilities.wakeword && windowMs > 0
	if (!willFollowUp) {
		playFeedbackSound(domia, "done")
		return
	}

	if (!tryBeginRecording(domiaId)) {
		domiaBusLogger.warn(
			`🚫 follow-up window skipped — recording already in progress for ${domiaId}`,
		)
		return
	}

	try {
		if (speculationEligible(ctx)) {
			await runFollowUpSpeculative(ctx)
			return
		}
		const recording = await startFollowUpRecording(domia)
		if (!recording) {
			playFeedbackSound(domia, "done")
			return
		}
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath: recording.filePath,
			originDomiaKey: domia.domiaKey,
			speechEndAt: recording.speechEndAt ?? undefined,
			liveVoice: true,
		})
	} catch (err) {
		domiaBusLogger.error("follow-up recording failed", { domiaId, err })
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, {
			error: toError(err),
		})
	} finally {
		endRecording(domiaId)
	}
}

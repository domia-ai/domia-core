import {
	publishToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	emitTurnEvent,
	DOMIA_TURN_EVENT_ENUM,
} from "@/buses"
import {
	domiaBusLogger,
	getTraceContext,
	isDomiaError,
	toError,
	withTimeout,
} from "@/utils"
import {
	completeInteraction,
	INTERACTION_COMPLETION_TIMEOUT,
} from "./interaction-runtime"
import {
	updateInteraction,
	getInteractionById,
} from "@/modules/session-manager"
import { INTERACTION_STATUS_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import { claimTurnCompleted } from "./turn-completion-guard"
import { playAudio } from "@/modules/audio-playback"
import { runTTS } from "@/modules/tts-engine"
import { deliverEvent } from "@/modules/grpc-client"
import { getDomiaByDomiaKey } from "@/modules/core"
import { resolveDomiaStreamingCapabilities } from "@/modules/capability-resolver"
import { resolveFallbackMessage } from "./fallback-messages"
import type {
	CoreBusContextType,
	InteractionStatusType,
	NotifyAudioFallbackArgsType,
	NotifyInteractionFailedArgsType,
	ForwardFailurePayloadType,
	PersistTerminalOptsType,
} from "../types"

const FALLBACK_TTS_TIMEOUT_MS = 8000

const playFallbackAudio = async (
	ctx: CoreBusContextType,
	step: string | undefined,
): Promise<boolean> => {
	if (!ctx.domia.runtimeCapabilities?.playback) return false
	if (step === "tts") {
		domiaBusLogger.warn(
			"⚠️ TTS failed — cannot speak the fallback (would recurse)",
			{ domiaId: ctx.domia.id },
		)
		return false
	}
	const message = resolveFallbackMessage(
		step,
		ctx.domia.characterProfile?.language,
	)
	try {
		const tts = await withTimeout(
			runTTS(ctx.domia, message),
			FALLBACK_TTS_TIMEOUT_MS,
			"fallback TTS",
		)
		if (!tts?.filePath) {
			domiaBusLogger.warn("⚠️ Fallback TTS produced no file", {
				domiaId: ctx.domia.id,
				step,
			})
			return false
		}
		const result = await playAudio(ctx.domia, tts.filePath)
		return result?.success === true && result?.interrupted !== true
	} catch (err) {
		domiaBusLogger.warn("⚠️ Fallback audio failed", {
			err,
			domiaId: ctx.domia.id,
			step,
		})
		return false
	}
}

const forwardFailureToOrigin = async (
	ctx: CoreBusContextType,
	originDomiaKey: string,
	payload: ForwardFailurePayloadType,
): Promise<void> => {
	const originDomia = await getDomiaByDomiaKey(originDomiaKey)
	if (!originDomia) {
		domiaBusLogger.warn(
			"⚠️ interaction failure not forwarded — origin domia unknown locally",
			{ originDomiaKey, interactionId: payload.interactionId },
		)
		return
	}
	await deliverEvent(
		ctx.domia.domiaKey,
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
		"interactionFailed",
		payload,
	)
}

export const notifyInteractionFailed = (
	ctx: CoreBusContextType,
	args: NotifyInteractionFailedArgsType,
): void => {
	const { domia } = ctx
	const {
		interactionId,
		originDomiaKey,
		responseType,
		error,
		step,
		silent,
		liveVoice,
	} = args
	const err = toError(error)
	const payload = {
		interactionId,
		originDomiaKey,
		responseType,
		error: err.message,
		step,
		errorCode: isDomiaError(error) ? error.code : undefined,
		liveVoice,
	}
	publishToDomiaBus(
		ctx.domia.id,
		DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
		payload,
	)
	if (originDomiaKey && originDomiaKey !== domia.domiaKey) {
		void forwardFailureToOrigin(ctx, originDomiaKey, payload).catch((e) =>
			domiaBusLogger.warn("⚠️ interaction failure forward to origin failed", {
				originDomiaKey,
				interactionId,
				err: e,
			}),
		)
	}
	if (responseType === RESPONSE_TYPE_ENUM.TEXT) return
	if (silent) return
	void playFallbackAudio(ctx, step)
}

export const notifyAudioFallback = (
	ctx: CoreBusContextType,
	args: NotifyAudioFallbackArgsType,
): void => {
	const { interactionId, originDomiaKey, reason, error, reply } = args
	const err = toError(error)
	domiaBusLogger.warn(
		`⚠️ audio fallback (${reason}) — interaction continues without playback`,
		{
			domiaId: ctx.domia.id,
			interactionId,
			reason,
			error: err.message,
			...(reply ? { replyPreview: reply.slice(0, 200) } : {}),
		},
	)
	void playFallbackAudio(ctx, reason === "tts_failed" ? "tts" : reason).then(
		(played) =>
			publishToDomiaBus(ctx.domia.id, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
				interactionId,
				originDomiaKey,
				status: played ? "completed" : "failed",
				playedLocally: played,
			}),
	)
}

const TERMINAL_STATUSES: readonly string[] = [
	INTERACTION_STATUS_ENUM.FAILED,
	INTERACTION_STATUS_ENUM.ABORTED,
	INTERACTION_STATUS_ENUM.NO_SPEECH,
]

export const persistTerminal = async (
	interactionId: string,
	status: InteractionStatusType,
	opts: PersistTerminalOptsType = {},
): Promise<void> => {
	try {
		const existing = await getInteractionById(interactionId)
		if (existing && TERMINAL_STATUSES.includes(existing.status)) return
		await updateInteraction({
			id: interactionId,
			status,
			...(opts.errorStep !== undefined ? { errorStep: opts.errorStep } : {}),
			...(opts.errorMessage !== undefined
				? { errorMessage: opts.errorMessage }
				: {}),
		})
		if (!claimTurnCompleted(interactionId)) return
		const ctx = getTraceContext()
		const originDomiaKey = ctx?.originDomiaKey ?? ""
		if (status === INTERACTION_STATUS_ENUM.FAILED) {
			emitTurnEvent({
				type: DOMIA_TURN_EVENT_ENUM.TURN_FAILED,
				interactionId,
				originDomiaKey,
				traceId: ctx?.traceId,
				step: opts.errorStep,
				errorCode: opts.errorCode,
				errorMessage: opts.errorMessage ?? "failed",
			})
		} else {
			emitTurnEvent({
				type: DOMIA_TURN_EVENT_ENUM.TURN_ABORTED,
				interactionId,
				originDomiaKey,
				traceId: ctx?.traceId,
				reason:
					status === INTERACTION_STATUS_ENUM.NO_SPEECH
						? "no_speech"
						: (opts.errorStep ?? "aborted"),
			})
		}
	} catch (err) {
		domiaBusLogger.warn("⚠️ failed to persist terminal state", {
			interactionId,
			status,
			err,
		})
	}
}

export const persistInteractionTimeout = (interactionId: string): void => {
	void persistTerminal(interactionId, INTERACTION_STATUS_ENUM.FAILED, {
		errorStep: "timeout",
		errorMessage: INTERACTION_COMPLETION_TIMEOUT,
	})
}

export const notifyTurnAborted = async (
	domiaId: string,
	interactionId: string,
	originDomiaKey: string | undefined,
	reply = "",
): Promise<void> => {
	await persistTerminal(interactionId, INTERACTION_STATUS_ENUM.ABORTED)
	completeInteraction(interactionId, { interrupted: true, result: { reply } })
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
		interactionId,
		originDomiaKey,
		status: "interrupted",
		playedLocally: false,
	})
	domiaBusLogger.info(`🛑 turn aborted — stage skipped`, {
		domiaId,
		interactionId,
	})
}

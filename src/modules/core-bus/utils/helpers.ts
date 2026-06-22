import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, toError, withTimeout } from "@/utils"
import { rejectPending, resolvePending } from "./pending-requests"
import { updateInteraction } from "@/modules/session-manager"
import { INTERACTION_STATUS_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import { playAudio } from "@/modules/audio-playback"
import { runTTS } from "@/modules/tts-engine"
import { deliverEvent } from "@/modules/grpc-client"
import { getDomiaByDomiaKey } from "@/modules/core"
import { resolveDomiaStreamingCapabilities } from "@/modules/capability-resolver"
import { resolveFallbackMessage } from "./fallback-messages"
import type {
	CoreBusContextType,
	NotifyAudioFallbackArgsType,
	NotifyInteractionFailedArgsType,
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
	const message = resolveFallbackMessage(step)
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
	payload: {
		interactionId: string | undefined
		originDomiaKey: string | undefined
		responseType: string | undefined
		error: string
		step: string | undefined
	},
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
	if (responseType === RESPONSE_TYPE_ENUM.TEXT) {
		rejectPending(interactionId, err)
		return
	}
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

export const notifyTurnAborted = async (
	domiaId: string,
	interactionId: string,
	originDomiaKey: string | undefined,
	reply = "",
): Promise<void> => {
	await updateInteraction({
		id: interactionId,
		status: INTERACTION_STATUS_ENUM.ABORTED,
	}).catch(() => undefined)
	resolvePending(interactionId, reply)
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

import { readFile } from "fs/promises"

import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { getWavDurationMs, domiaBusLogger, toError } from "@/utils"
import { CAPABILITY_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import { playAudio } from "@/modules/audio-playback"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import { deliverEvent } from "@/modules/grpc-client"
import { reflectOnInteraction } from "@/modules/reflection"
import { pipelineElapsed, updateInteraction } from "@/modules/session-manager"
import { downloadAudioToTemp } from "./audio"
import {
	notifyAudioFallback,
	notifyInteractionFailed,
	notifyTurnAborted,
} from "./helpers"
import { heardReplyOf } from "./fallback-messages"
import { heardTextFromUniformRate } from "./spoken-position"
import { isTurnAborted } from "./turn-scope"
import type {
	CoreBusContextType,
	TtsDonePayloadType,
	DeliverySinkType,
	InteractionAudioDeliveryType,
} from "../types"

export const resolveDeliverySink = (
	audioDelivery: InteractionAudioDeliveryType | undefined,
	canPlayback: boolean,
): DeliverySinkType => {
	if (
		audioDelivery === "streaming-sink" ||
		audioDelivery === "audio-url" ||
		audioDelivery === "none"
	) {
		return { terminalAt: "dispatch" }
	}
	return {
		terminalAt: "playback",
		deliver: canPlayback ? deliverLocalPlayback : deliverDelegatedPlayback,
	}
}

export const deliverLocalPlayback = async (
	ctx: CoreBusContextType,
	interactionId: string,
	payload: TtsDonePayloadType,
): Promise<void> => {
	const { domia } = ctx
	const domiaId = domia.id
	const { filePath, reply, transcript, originDomiaKey, audioUrl, liveVoice } =
		payload

	let pathToPlay = filePath
	if (audioUrl) {
		domiaBusLogger.info(`🗣️ TTS_DONE: fetching audio from ${audioUrl}`, {
			domiaId,
		})
		pathToPlay = await downloadAudioToTemp(audioUrl, interactionId)
	} else if (filePath) {
		domiaBusLogger.info(`🗣️ TTS_DONE: ${filePath}`, { domiaId })
	}
	if (!pathToPlay) {
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
			error: toError("TTS_DONE: missing filePath and audioUrl"),
			step: "playback",
			liveVoice,
		})
		return
	}
	if (isTurnAborted(domiaId, interactionId)) {
		domiaBusLogger.info(
			"🛑 TTS_DONE: turn aborted before playback — skipping stale reply",
			{ domiaId, interactionId },
		)
		await notifyTurnAborted(domiaId, interactionId, originDomiaKey, reply)
		return
	}
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED, {
		interactionId,
		originDomiaKey,
		playedLocally: false,
	})
	await updateInteraction({
		id: interactionId,
		ttfaMs: pipelineElapsed(interactionId),
	})
	let playResult: Awaited<ReturnType<typeof playAudio>>
	try {
		playResult = await playAudio(domia, pathToPlay)
	} catch (err) {
		notifyAudioFallback(ctx, {
			interactionId,
			originDomiaKey,
			reason: "playback_failed",
			error: toError(err),
		})
		return
	}
	const interrupted = playResult?.interrupted === true
	if (playResult && playResult.success === false) {
		notifyAudioFallback(ctx, {
			interactionId,
			originDomiaKey,
			reason: "playback_failed",
			error: toError(`audio playback failed (engine ${playResult.engine})`),
		})
		return
	}
	if (reply !== undefined) {
		const wordLevel = domia.audioPlaybackConfig?.wordLevelHeardEnabled ?? false
		const heardText =
			interrupted && wordLevel && playResult?.playedMs !== undefined
				? heardTextFromUniformRate(
						reply,
						playResult.playedMs,
						(await getWavDurationMs(pathToPlay).catch(() => 0)) ?? 0,
					)
				: undefined
		const heardReply = heardReplyOf(reply, {
			audioStarted: true,
			interrupted,
			heardText,
		})
		await updateInteraction({ id: interactionId, heardReply })
		if (heardReply && transcript) {
			void reflectOnInteraction(
				domia,
				transcript,
				heardReply,
				interactionId,
				originDomiaKey,
			)
		}
	}
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
		interactionId,
		originDomiaKey,
		status: interrupted ? "interrupted" : "completed",
		playedLocally: true,
		liveVoice,
	})
}

export const deliverDelegatedPlayback = async (
	ctx: CoreBusContextType,
	interactionId: string,
	payload: TtsDonePayloadType,
): Promise<void> => {
	const { domia } = ctx
	const domiaId = domia.id
	const { filePath, audioUrl, originDomiaKey } = payload

	const targets = await resolveCapabilityDelegations(
		domia,
		CAPABILITY_ENUM.PLAYBACK,
	)
	if (targets.length === 0) {
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
			capability: CAPABILITY_ENUM.PLAYBACK,
			interactionId,
			originDomiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
		})
		return
	}

	let localPath = filePath
	if (!localPath && audioUrl) {
		localPath = await downloadAudioToTemp(audioUrl, interactionId)
	}
	if (!localPath) {
		throw new Error(
			"TTS_DONE: cannot delegate playback without filePath or audioUrl",
		)
	}
	const audio = await readFile(localPath)
	const result = await deliverEvent(domia.domiaKey, targets, "ttsDone", {
		audio,
		interactionId,
		originDomiaKey,
	})
	if (!result.delivered) {
		throw new Error(
			`TTS_DONE→playback delegation failed: ${result.error ?? "unknown"}`,
		)
	}
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
		interactionId,
		originDomiaKey,
		status: "completed",
		playedLocally: false,
	})
}

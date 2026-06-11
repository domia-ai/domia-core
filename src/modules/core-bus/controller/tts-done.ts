import { readFile } from "fs/promises"

import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, setTraceContext, toError } from "@/utils"
import {
	downloadAudioToTemp,
	notifyAudioFallback,
	notifyInteractionFailed,
} from "../utils"
import { getOrCreateInteractionId } from "@/modules/session-manager"
import {
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	RESPONSE_TYPE_ENUM,
} from "@/db"
import { playAudio } from "@/modules/audio-playback"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import { deliverEvent } from "@/modules/grpc-client"
import type { CoreBusContextType, TtsDonePayloadType } from "../types"

export const handleTtsDone = async (
	ctx: CoreBusContextType,
	payload: TtsDonePayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const { canPlayback } = features
	const domiaId = domia.id
	const { filePath, originDomiaKey, audioUrl } = payload

	setTraceContext({ interactionId: payload.interactionId, originDomiaKey })
	if (!filePath && !audioUrl) {
		domiaBusLogger.info(
			`🗣️ TTS_DONE: no filePath/audioUrl — already streamed, skipping handler`,
			{ domiaId, interactionId: payload.interactionId },
		)
		return
	}

	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
		},
	)
	if (!interactionId) return
	setTraceContext({ interactionId, originDomiaKey })

	try {
		if (canPlayback) {
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
				})
				return
			}
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED, {
				interactionId,
				originDomiaKey,
			})
			try {
				const playResult = await playAudio(domia, pathToPlay)
				if (playResult && playResult.success === false) {
					notifyAudioFallback(ctx, {
						interactionId,
						originDomiaKey,
						reason: "playback_failed",
						error: toError(
							`audio playback failed (engine ${playResult.engine})`,
						),
					})
					return
				}
			} catch (err) {
				notifyAudioFallback(ctx, {
					interactionId,
					originDomiaKey,
					reason: "playback_failed",
					error: toError(err),
				})
				return
			}
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
				interactionId,
				originDomiaKey,
			})
			return
		}

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
	} catch (err) {
		domiaBusLogger.error("TTS_DONE: playback or delegate failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
			error: toError(err),
			step: "playback",
		})
	}
}

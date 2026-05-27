import { readFile } from "fs/promises"

import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import {
	domiaBusLogger,
	setTraceContext,
	toError,
	wavFileToPcmChunks,
} from "@/utils"
import { downloadAudioToTemp, notifyInteractionFailed } from "../utils"
import { getOrCreateInteractionId } from "@/modules/session-manager"
import {
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	RESPONSE_TYPE_ENUM,
} from "@/db"
import { runSTT } from "@/modules/stt-engine"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import { deliverEvent, streamSttToTarget } from "@/modules/grpc-client"
import type { AudioReadyPayloadType, CoreBusContextType } from "../types"

export const handleAudioReady = async (
	ctx: CoreBusContextType,
	payload: AudioReadyPayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const { canRunStt } = features
	const domiaId = domia.id
	const { filePath, audioUrl, originDomiaKey } = payload

	setTraceContext({ interactionId: payload.interactionId, originDomiaKey })
	domiaBusLogger.info(`🎧 AUDIO_READY received`, {
		domiaId,
		filePath,
		audioUrl,
	})
	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputAudioPath: filePath,
			inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
		},
	)
	if (!interactionId) return
	setTraceContext({ interactionId, originDomiaKey })
	domiaBusLogger.info(`🆕 Interaction ${interactionId}`, { domiaId })

	try {
		if (canRunStt) {
			let pathForStt = filePath
			if (!pathForStt && audioUrl) {
				domiaBusLogger.info(
					`🎧 AUDIO_READY: fetching remote audio from ${audioUrl}`,
					{ domiaId, interactionId },
				)
				pathForStt = await downloadAudioToTemp(audioUrl, interactionId)
			}
			if (!pathForStt) {
				throw new Error("AUDIO_READY: missing filePath and audioUrl")
			}
			const transcript = await runSTT(domia, pathForStt)
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
				transcript,
				interactionId,
				originDomiaKey,
			})
			return
		}

		const targets = await resolveCapabilityDelegations(
			domia,
			CAPABILITY_ENUM.STT,
		)
		if (targets.length === 0) {
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
				capability: CAPABILITY_ENUM.STT,
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
				"AUDIO_READY: cannot delegate without filePath or audioUrl",
			)
		}
		const audioPath: string = localPath

		const streamingTargets = targets.filter(
			(target) => target.streamingCapabilities.stt,
		)
		if (streamingTargets.length > 0) {
			domiaBusLogger.info(
				`📡 streaming STT delegation (${streamingTargets.length} targets)`,
				{ domiaId, interactionId },
			)
			const streamed = await streamSttToTarget(
				domia.domiaKey,
				streamingTargets,
				{
					originDomiaKey,
					interactionId,
					responseType: RESPONSE_TYPE_ENUM.VOICE,
				},
				() => wavFileToPcmChunks(audioPath),
			)
			if (streamed.delivered && streamed.transcript !== undefined) {
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
					transcript: streamed.transcript,
					interactionId,
					originDomiaKey,
				})
				return
			}
			domiaBusLogger.warn(
				`streaming STT delegation failed (${streamed.error ?? "unknown"}) — falling back to unary`,
				{ domiaId, interactionId },
			)
		}

		const audio = await readFile(audioPath)
		const result = await deliverEvent(domia.domiaKey, targets, "audioReady", {
			audio,
			originDomiaKey,
			interactionId,
		})
		if (!result.delivered) {
			throw new Error(
				`AUDIO_READY delegation failed: ${result.error ?? "unknown"} (tried ${result.attemptedTargets})`,
			)
		}
	} catch (err) {
		domiaBusLogger.error("AUDIO_READY: STT or delegate failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
			error: toError(err),
			step: "stt",
		})
	}
}

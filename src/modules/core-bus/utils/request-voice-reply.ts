import { existsSync } from "fs"
import path from "path"

import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import { getWavDurationMs } from "@/utils"
import type { DomiaType } from "@/modules/core"
import { reflectOnInteraction } from "@/modules/reflection"
import { getOrCreateInteractionId } from "@/modules/session-manager"
import { prefetchMemoryBundle } from "./prefetch-memory"
import { beginTurn } from "./turn-scope"
import { setPresenceStatus } from "./presence-registry"
import {
	registerInteractionRuntime,
	awaitInteractionResult,
	clearInteraction,
	INTERACTION_COMPLETION_TIMEOUT,
} from "./interaction-runtime"
import { persistInteractionTimeout } from "./helpers"
import type {
	RequestVoiceReplyOptions,
	RequestVoiceReplyResult,
	InteractionCompletionResultType,
} from "../types"

const DEFAULT_TIMEOUT_MS = 60_000

export const requestVoiceReply = async (
	domia: DomiaType,
	audioPath: string,
	options: RequestVoiceReplyOptions = {},
): Promise<RequestVoiceReplyResult> => {
	const {
		timeoutMs = DEFAULT_TIMEOUT_MS,
		speak = true,
		onStage,
		interactionId: providedId,
		satelliteId,
		satelliteProtocol,
	} = options

	const absPath = path.resolve(audioPath)
	if (!existsSync(absPath)) {
		throw new Error(`requestVoiceReply: audio file not found: ${absPath}`)
	}

	const interactionId = await getOrCreateInteractionId(domia, providedId, {
		inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
		responseType: speak ? RESPONSE_TYPE_ENUM.VOICE : RESPONSE_TYPE_ENUM.TEXT,
		inputAudioPath: absPath,
		inputAudioMs: await getWavDurationMs(absPath),
		satelliteId: satelliteId ?? null,
		satelliteProtocol: satelliteProtocol ?? null,
	})
	if (!interactionId) {
		throw new Error("requestVoiceReply: failed to create interaction")
	}
	prefetchMemoryBundle(domia, interactionId)

	const domiaId = domia.id
	const turn = beginTurn(domiaId, interactionId)
	setPresenceStatus(domia.domiaKey, "thinking", true)

	registerInteractionRuntime({
		interactionId,
		originDomiaKey: domia.domiaKey,
		inputMode: "audio",
		responseType: speak ? "voice" : "text",
		audioDelivery: "local-playback",
		satelliteId,
		wantsCompletion: true,
		onStage,
		timings: { createdAt: Date.now() },
	})
	const completion = awaitInteractionResult(interactionId, timeoutMs)
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
		filePath: absPath,
		interactionId,
		originDomiaKey: domia.domiaKey,
		responseType: speak ? RESPONSE_TYPE_ENUM.VOICE : RESPONSE_TYPE_ENUM.TEXT,
	})

	let result: InteractionCompletionResultType
	try {
		result = await completion
	} catch (err) {
		const timedOut =
			err instanceof Error && err.message === INTERACTION_COMPLETION_TIMEOUT
		turn.abort(timedOut ? "timeout" : "error")
		if (timedOut) persistInteractionTimeout(interactionId)
		throw err
	} finally {
		turn.end()
		setPresenceStatus(domia.domiaKey, "idle", true)
		clearInteraction(interactionId)
	}

	if (result.transcript && result.reply) {
		void reflectOnInteraction(
			domia,
			result.transcript,
			result.reply,
			interactionId,
			domia.domiaKey,
		)
	}

	return {
		interactionId,
		transcript: result.transcript,
		reply: result.reply,
		ttsFilePath: result.ttsFilePath,
	}
}

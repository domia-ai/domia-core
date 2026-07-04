import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import type { DomiaType } from "@/modules/core"
import { getOrCreateInteractionId } from "@/modules/session-manager"
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
	RequestTextToVoiceReplyResult,
	InteractionCompletionResultType,
} from "../types"

const DEFAULT_TIMEOUT_MS = 60_000

export const requestTextToVoiceReply = async (
	domia: DomiaType,
	text: string,
	options: RequestVoiceReplyOptions = {},
): Promise<RequestTextToVoiceReplyResult> => {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, onStage } = options

	const interactionId = await getOrCreateInteractionId(domia, undefined, {
		inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
		responseType: RESPONSE_TYPE_ENUM.VOICE,
	})
	if (!interactionId) {
		throw new Error("requestTextToVoiceReply: failed to create interaction")
	}

	const domiaId = domia.id
	const turn = beginTurn(domiaId, interactionId)
	setPresenceStatus(domia.domiaKey, "thinking", true)

	registerInteractionRuntime({
		interactionId,
		originDomiaKey: domia.domiaKey,
		inputMode: "text",
		responseType: "voice",
		audioDelivery: "local-playback",
		wantsCompletion: true,
		onStage,
		timings: { createdAt: Date.now() },
	})
	const completion = awaitInteractionResult(interactionId, timeoutMs)
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
		transcript: text,
		interactionId,
		originDomiaKey: domia.domiaKey,
		responseType: RESPONSE_TYPE_ENUM.VOICE,
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

	return {
		interactionId,
		reply: result.reply,
		ttsFilePath: result.ttsFilePath,
	}
}

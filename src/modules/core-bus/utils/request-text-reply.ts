import { type DomiaType } from "@/modules/core"
import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { getOrCreateInteractionId } from "@/modules/session-manager"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import { type RequestTextReplyResult } from "@/modules/core-bus/types"
import {
	registerInteractionRuntime,
	awaitInteractionResult,
} from "./interaction-runtime"

const DEFAULT_TIMEOUT_MS = 60_000

export const requestTextReply = (
	domia: DomiaType,
	text: string,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<RequestTextReplyResult> => {
	return (async () => {
		const interactionId = await getOrCreateInteractionId(domia, undefined, {
			inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
			responseType: RESPONSE_TYPE_ENUM.TEXT,
		})
		if (!interactionId) {
			throw new Error("Failed to create interaction")
		}
		registerInteractionRuntime({
			interactionId,
			originDomiaKey: domia.domiaKey,
			inputMode: "text",
			responseType: "text",
			audioDelivery: "none",
			wantsCompletion: true,
			timings: { createdAt: Date.now() },
		})
		const completion = awaitInteractionResult(interactionId, timeoutMs)
		publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
			transcript: text,
			interactionId,
			originDomiaKey: domia.domiaKey,
			responseType: RESPONSE_TYPE_ENUM.TEXT,
		})
		const { reply } = await completion
		return { reply, interactionId }
	})()
}

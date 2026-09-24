import { type DomiaType } from "@/modules/core"
import { runInteraction } from "./run-interaction"
import {
	type RequestTextReplyResult,
	type TextDeltaSinkType,
} from "@/modules/core-bus/types"

export const requestTextReply = async (
	domia: DomiaType,
	text: string,
	timeoutMs?: number,
	interactionId?: string,
	satelliteId?: string,
	onDelta?: TextDeltaSinkType,
): Promise<RequestTextReplyResult> => {
	const result = await runInteraction(domia, {
		input: { kind: "text", text },
		requestedOutput: { kind: "text" },
		source: "http",
		audioDelivery: "none",
		timeoutMs,
		interactionId,
		satelliteId,
		onDelta,
	})
	return { reply: result.reply, interactionId: result.interactionId }
}

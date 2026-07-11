import { type DomiaType } from "@/modules/core"
import { runInteraction } from "./run-interaction"
import { type RequestTextReplyResult } from "@/modules/core-bus/types"

export const requestTextReply = async (
	domia: DomiaType,
	text: string,
	timeoutMs?: number,
	interactionId?: string,
): Promise<RequestTextReplyResult> => {
	const result = await runInteraction(domia, {
		input: { kind: "text", text },
		requestedOutput: { kind: "text" },
		source: "http",
		audioDelivery: "none",
		timeoutMs,
		interactionId,
	})
	return { reply: result.reply, interactionId: result.interactionId }
}

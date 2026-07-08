import type { DomiaType } from "@/modules/core"
import { runInteraction } from "./run-interaction"
import type {
	RequestVoiceReplyOptions,
	RequestTextToVoiceReplyResult,
} from "../types"

export const requestTextToVoiceReply = async (
	domia: DomiaType,
	text: string,
	options: RequestVoiceReplyOptions = {},
): Promise<RequestTextToVoiceReplyResult> => {
	const result = await runInteraction(domia, {
		input: { kind: "text", text },
		requestedOutput: { kind: "voice" },
		source: "http",
		audioDelivery: "none",
		timeoutMs: options.timeoutMs,
		onStage: options.onStage,
		liveTurn: true,
	})

	return {
		interactionId: result.interactionId,
		reply: result.reply,
		ttsFilePath: result.ttsFilePath,
	}
}

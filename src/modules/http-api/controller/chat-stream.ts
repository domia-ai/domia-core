import type { FastifyReply } from "fastify"

import { generateUuid, httpServerLogger, setTraceContext } from "@/utils"
import { type DomiaType } from "@/modules/core"
import { requestTextReply } from "@/modules/core-bus"
import { onTurnEvent, type DomiaTurnEventType } from "@/buses"
import { postChatBodySchema } from "../schemas"
import type { PostChatBodyType } from "../types"
import { toAgUiEvent } from "../utils/ag-ui"

const sseFrame = (event: string, data: unknown): string =>
	`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

export const handlePostChatStream = async (
	domia: DomiaType,
	body: PostChatBodyType,
	reply: FastifyReply,
): Promise<void> => {
	const { text } = postChatBodySchema.parse(body)
	const interactionId = generateUuid()
	setTraceContext({ originDomiaKey: domia.domiaKey })

	reply.hijack()
	reply.raw.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	})

	let errored = false
	const write = (event: string, data: unknown): void => {
		if (!reply.raw.writableEnded) reply.raw.write(sseFrame(event, data))
	}
	const writeError = (message: string): void => {
		if (errored) return
		errored = true
		write("RUN_ERROR", { runId: interactionId, message })
	}

	write("RUN_STARTED", { threadId: domia.domiaKey, runId: interactionId })

	const unsubscribe = onTurnEvent(
		{ interactionId },
		(event: DomiaTurnEventType) => {
			const mapped = toAgUiEvent(event)
			if (!mapped) return
			if (mapped.event === "RUN_ERROR") {
				writeError(String(mapped.data.message ?? "turn failed"))
			} else {
				write(mapped.event, mapped.data)
			}
		},
	)

	try {
		const result = await requestTextReply(domia, text, undefined, interactionId)
		const messageId = generateUuid()
		write("TEXT_MESSAGE_START", { messageId, role: "assistant" })
		write("TEXT_MESSAGE_CONTENT", { messageId, delta: result.reply })
		write("TEXT_MESSAGE_END", { messageId })
		if (!errored) write("RUN_FINISHED", { runId: interactionId })
	} catch (err) {
		httpServerLogger.error("chat stream failed", { domiaId: domia.id, err })
		writeError(err instanceof Error ? err.message : String(err))
	} finally {
		unsubscribe()
		if (!reply.raw.writableEnded) reply.raw.end()
	}
}

import type { FastifyReply } from "fastify"

import { generateUuid, httpServerLogger, setTraceContext } from "@/utils"
import { type DomiaType } from "@/modules/core"
import { requestTextReply } from "@/modules/core-bus"
import { onTurnEvent, type DomiaTurnEventType } from "@/buses"
import { postChatStreamBodySchema } from "../schemas"
import { badRequest } from "../utils/http-errors"
import { toAgUiEvent } from "../utils/ag-ui"

const sseFrame = (event: string, data: unknown): string =>
	`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

export const handlePostChatStream = async (
	domia: DomiaType,
	body: unknown,
	reply: FastifyReply,
): Promise<void> => {
	const parsed = postChatStreamBodySchema.safeParse(body)
	if (!parsed.success) {
		await badRequest(reply, parsed.error, "Invalid chat stream body")
		return
	}
	const { text, satelliteId } = parsed.data
	const interactionId = generateUuid()
	setTraceContext({ originDomiaKey: domia.domiaKey, satelliteId })

	reply.hijack()
	reply.raw.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	})

	const errored = { current: false }
	const write = (event: string, data: unknown): void => {
		if (!reply.raw.writableEnded) reply.raw.write(sseFrame(event, data))
	}
	const writeError = (message: string): void => {
		if (errored.current) return
		errored.current = true
		write("RUN_ERROR", { runId: interactionId, message })
	}

	write("RUN_STARTED", { threadId: domia.domiaKey, runId: interactionId })

	const messageId = generateUuid()
	const started = { current: false }
	const ended = { current: false }
	const startMessage = (): void => {
		if (started.current) return
		started.current = true
		write("TEXT_MESSAGE_START", { messageId, role: "assistant" })
	}
	const endMessage = (): void => {
		if (!started.current || ended.current) return
		ended.current = true
		write("TEXT_MESSAGE_END", { messageId })
	}

	const unsubscribe = onTurnEvent(
		{ interactionId },
		(event: DomiaTurnEventType) => {
			const mapped = toAgUiEvent(event)
			if (!mapped) return
			if (mapped.event === "RUN_ERROR") {
				const message = mapped.data.message
				endMessage()
				writeError(typeof message === "string" ? message : "turn failed")
			} else {
				write(mapped.event, mapped.data)
			}
		},
	)

	try {
		const result = await requestTextReply(
			domia,
			text,
			undefined,
			interactionId,
			satelliteId,
			(delta) => {
				startMessage()
				write("TEXT_MESSAGE_CONTENT", { messageId, delta })
			},
		)
		if (!started.current) {
			startMessage()
			write("TEXT_MESSAGE_CONTENT", { messageId, delta: result.reply })
		}
		endMessage()
		if (!errored.current) write("RUN_FINISHED", { runId: interactionId })
	} catch (err) {
		httpServerLogger.error("chat stream failed", { domiaId: domia.id, err })
		endMessage()
		writeError(err instanceof Error ? err.message : String(err))
	} finally {
		unsubscribe()
		if (!reply.raw.writableEnded) reply.raw.end()
	}
}

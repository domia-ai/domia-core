import { createReadStream } from "fs"
import { type DomiaType } from "@/modules/core"
import type {
	PostChatBodyType,
	PostChatResponseType,
	GetAudioRouteType,
} from "../types"
import { postChatBodySchema } from "../schemas"
import { requestTextReply } from "@/modules/core-bus"
import { getAudioFilePath } from "@/modules/core-bus"
import { httpServerLogger } from "@/utils"
import type { FastifyRequest, FastifyReply } from "fastify"

export const handleGetRoot = () => {
	return { message: "DOMIA HTTP Server is running ✅" }
}

export const handleGetHealth = () => {
	return { status: "ok", timestamp: new Date().toISOString() }
}

export const handleGetAudio = async (
	request: FastifyRequest<GetAudioRouteType>,
	reply: FastifyReply,
) => {
	const { interactionId } = request.params
	const filePath = getAudioFilePath(interactionId)
	if (!filePath) {
		return reply.code(404).send({ error: "Audio not found or expired" })
	}
	const stream = createReadStream(filePath)
	return reply.type("audio/wav").send(stream)
}

export const handlePostChat = async (
	domia: DomiaType,
	body: PostChatBodyType,
): Promise<PostChatResponseType> => {
	const { text } = postChatBodySchema.parse(body)
	try {
		const reply = await requestTextReply(domia, text)
		return { reply }
	} catch (err) {
		httpServerLogger.error("Chat request failed", { domiaId: domia.id, err })
		throw err
	}
}

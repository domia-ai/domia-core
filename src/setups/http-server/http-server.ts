import Fastify from "fastify"
import { httpServerLogger } from "@/utils"
import { env } from "@/config"
import { type DomiaType } from "@/modules/core"
import {
	handleGetRoot,
	handleGetHealth,
	handleGetAudio,
	handlePostChat,
	handlePostVoice,
	type PostChatRouteType,
	type GetAudioRouteType,
	type PostVoiceRouteType,
} from "@/modules/http-api"

const HTTP_SERVER_HOST = env?.HTTP_SERVER_HOST
const HTTP_SERVER_PORT = Number(env?.HTTP_SERVER_PORT)

export const setupHttpServer = async ({ domia }: { domia: DomiaType }) => {
	httpServerLogger.info("🚀 Starting HTTP server...")

	const fastify = Fastify({
		logger: false,
	})

	fastify.get("/", async () => handleGetRoot())

	fastify.get("/health", async () => handleGetHealth())

	fastify.get<GetAudioRouteType>(
		"/audio/:interactionId",
		async (request, reply) => handleGetAudio(request, reply),
	)

	fastify.post<PostChatRouteType>("/chat", async (request) =>
		handlePostChat(domia, request.body),
	)

	fastify.post<PostVoiceRouteType>("/voice", async (request) =>
		handlePostVoice(domia, request.body),
	)

	try {
		await fastify.listen({ port: HTTP_SERVER_PORT, host: HTTP_SERVER_HOST })
		httpServerLogger.success(`✅ HTTP server ready on port ${HTTP_SERVER_PORT}`)
	} catch (err) {
		httpServerLogger.error("❌ Error starting HTTP server", { err })
		process.exit(1)
	}
}

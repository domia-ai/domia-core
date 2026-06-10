import Fastify from "fastify"
import { httpServerLogger } from "@/utils"
import { env } from "@/config"
import type { MqttClient } from "mqtt"
import { type DomiaType, getOwnDomia, invalidateOwnDomia } from "@/modules/core"
import { sendHeartbeat } from "@/modules/heartbeat-manager"
import {
	handleGetRoot,
	handleGetHealth,
	handleGetAudio,
	handlePostChat,
	handlePostVoice,
	handleGetMind,
	handleGetConfig,
	handlePostConfig,
	handleGetConfigHealth,
	handleRestart,
	handleGetModels,
	handlePostModelInstall,
	handleGetModelJob,
	handleImportMind,
	handleGetTemplates,
	handleActivateTemplate,
	handleGetSync,
	type PostChatRouteType,
	type GetAudioRouteType,
	type GetSyncRouteType,
	type PostVoiceRouteType,
	type PostImportMindRouteType,
	type TemplateIdRouteType,
} from "@/modules/http-api"

const HTTP_SERVER_HOST = env?.HTTP_SERVER_HOST
const HTTP_SERVER_PORT = Number(env?.HTTP_SERVER_PORT)

const liveDomia = async (fallback: DomiaType): Promise<DomiaType> => {
	try {
		return (await getOwnDomia()) ?? fallback
	} catch (err) {
		httpServerLogger.warn("getOwnDomia failed — using boot domia", { err })
		return fallback
	}
}

export const setupHttpServer = async ({
	domia,
	mqttClient,
}: {
	domia: DomiaType
	mqttClient: MqttClient | null
}) => {
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
		handlePostChat(await liveDomia(domia), request.body),
	)

	fastify.post<PostVoiceRouteType>("/voice", async (request) =>
		handlePostVoice(await liveDomia(domia), request.body),
	)

	fastify.post("/config/refresh", async () => {
		invalidateOwnDomia()
		void sendHeartbeat({ domia: await liveDomia(domia), mqttClient })
		httpServerLogger.info("🔄 config cache invalidated via /config/refresh")
		return { refreshed: true }
	})

	fastify.get<GetSyncRouteType>("/sync", async (request) =>
		handleGetSync(await liveDomia(domia), request.query),
	)

	fastify.get("/mind", async () => handleGetMind(await liveDomia(domia)))

	fastify.get("/config", async () => handleGetConfig(await liveDomia(domia)))

	fastify.post("/config", async (request, reply) => {
		const live = await liveDomia(domia)
		const result = await handlePostConfig(live, request.body, reply)
		void sendHeartbeat({ domia: live, mqttClient })
		return result
	})

	fastify.get("/config/health", async () =>
		handleGetConfigHealth(await liveDomia(domia)),
	)

	fastify.post("/admin/restart", async () => {
		void sendHeartbeat({ domia: await liveDomia(domia), mqttClient })
		return handleRestart()
	})

	fastify.get("/models", async () => handleGetModels())

	fastify.post("/models/install", async (request, reply) =>
		handlePostModelInstall(request.body, reply),
	)

	fastify.get<{ Params: { id: string } }>(
		"/models/jobs/:id",
		async (request, reply) => handleGetModelJob(request.params.id, reply),
	)

	fastify.post<PostImportMindRouteType>(
		"/mind/import",
		async (request, reply) => {
			const live = await liveDomia(domia)
			const result = await handleImportMind(live, request.body, reply)
			void sendHeartbeat({ domia: live, mqttClient })
			return result
		},
	)

	fastify.get("/templates", async () => handleGetTemplates())

	fastify.post<TemplateIdRouteType>(
		"/templates/:id/activate",
		async (request, reply) => {
			const live = await liveDomia(domia)
			const result = await handleActivateTemplate(
				live,
				request.params.id,
				reply,
			)
			void sendHeartbeat({ domia: live, mqttClient })
			return result
		},
	)

	try {
		await fastify.listen({ port: HTTP_SERVER_PORT, host: HTTP_SERVER_HOST })
		httpServerLogger.success(`✅ HTTP server ready on port ${HTTP_SERVER_PORT}`)
	} catch (err) {
		httpServerLogger.error("❌ Error starting HTTP server", { err })
		process.exit(1)
	}
}

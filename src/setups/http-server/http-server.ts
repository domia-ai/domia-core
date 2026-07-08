import { setGrpcClientTunables } from "@/modules/grpc-client"
import Fastify from "fastify"
import { httpServerLogger, isLoopbackAddress, isValidMeshBearer } from "@/utils"
import { env } from "@/config"
import {
	type DomiaType,
	getOwnDomia,
	safeOwnDomia,
	invalidateOwnDomia,
	isHostedIdentity,
} from "@/modules/core"
import { sendHeartbeat } from "@/modules/heartbeat-manager"
import { setupSatelliteGateway } from "@/modules/satellite-gateway"
import {
	handleGetRoot,
	handleGetHealth,
	handleGetAudio,
	handlePostChat,
	handlePostVoice,
	handlePostSpeak,
	handlePostAnnounceAudio,
	handleGetPresence,
	handlePostTurnCancel,
	handlePostIntercom,
	handleGetMind,
	handleGetConfig,
	handleGetKnowledge,
	handlePostKnowledge,
	handleDeleteKnowledge,
	handlePostConfig,
	handleGetConfigHealth,
	handleGetLatencyStats,
	handleRestart,
	handleGetModels,
	handlePostModelInstall,
	handleGetModelJob,
	handleImportMind,
	handleGetTemplates,
	handleActivateTemplate,
	handleGetIdentities,
	handlePostIdentity,
	handleDeleteIdentity,
	handleDiscoverSatellites,
	handleGetSatellites,
	handlePostSatellite,
	handleDeleteSatellite,
	handleSetSatelliteWakeWords,
	handleSetSatelliteNumber,
	handleSetSatelliteFollowUp,
	handleSetSatelliteVolume,
	handleStartSatelliteTimer,
	handleCancelSatelliteTimer,
	handleListSatelliteTimers,
	handleTestSatelliteSpeaker,
	handleGetSync,
	type PostChatRouteType,
	type GetAudioRouteType,
	type GetSyncRouteType,
	type PostVoiceRouteType,
	type PostSpeakRouteType,
	type PostImportMindRouteType,
	type TemplateIdRouteType,
} from "@/modules/http-api"

const HTTP_SERVER_HOST = env?.HTTP_SERVER_HOST
const HTTP_SERVER_PORT = Number(env?.HTTP_SERVER_PORT)

const liveDomia = async (
	fallback: DomiaType,
	domiaKey?: string,
): Promise<DomiaType> => {
	if (!domiaKey) {
		const own = await getOwnDomia().catch((err) => {
			httpServerLogger.warn("getOwnDomia failed — using boot domia", { err })
			return null
		})
		const resolved = own ?? fallback
		if (!isHostedIdentity(resolved.domiaKey))
			throw new Error(`identity not hosted: ${resolved.domiaKey}`)
		return resolved
	}
	if (!isHostedIdentity(domiaKey))
		throw new Error(`identity not hosted: ${domiaKey}`)
	const live = await safeOwnDomia(domiaKey, "http liveDomia")
	if (!live) throw new Error(`unknown identity: ${domiaKey}`)
	return live
}

const bodyDomiaKey = (body: unknown): string | undefined => {
	const key = (body as { domiaKey?: unknown } | null)?.domiaKey
	return typeof key === "string" && key.length > 0 ? key : undefined
}

const queryDomiaKey = (query: unknown): string | undefined => {
	const key = (query as { domiaKey?: unknown } | null)?.domiaKey
	return typeof key === "string" && key.length > 0 ? key : undefined
}

const AUTH_EXEMPT_PATHS = new Set(["/", "/health"])

const isAuthExempt = (method: string, url: string): boolean => {
	const pathname = url.split("?")[0]
	if (AUTH_EXEMPT_PATHS.has(pathname)) return true
	return method === "GET" && pathname.startsWith("/audio/")
}

export const setupHttpServer = async ({ domia }: { domia: DomiaType }) => {
	httpServerLogger.info("🚀 Starting HTTP server...")

	const fastify = Fastify({
		logger: false,
	})

	fastify.addHook("onRequest", async (request, reply) => {
		if (isAuthExempt(request.method, request.url)) return
		if (isLoopbackAddress(request.socket.remoteAddress)) return
		if (isValidMeshBearer(request.headers.authorization)) return
		await reply.code(401).send({ error: "unauthorized" })
	})

	fastify.get("/", async () => handleGetRoot())

	fastify.get("/health", async () => handleGetHealth())

	fastify.get<GetAudioRouteType>(
		"/audio/:interactionId",
		async (request, reply) => handleGetAudio(request, reply),
	)

	fastify.post<PostChatRouteType>("/chat", async (request) =>
		handlePostChat(
			await liveDomia(domia, bodyDomiaKey(request.body)),
			request.body,
		),
	)

	fastify.post<PostVoiceRouteType>("/voice", async (request) =>
		handlePostVoice(
			await liveDomia(domia, bodyDomiaKey(request.body)),
			request.body,
		),
	)

	fastify.post<PostSpeakRouteType>("/speak", async (request) =>
		handlePostSpeak(
			await liveDomia(domia, bodyDomiaKey(request.body)),
			request.body,
		),
	)

	fastify.post("/announce-audio", async (request) =>
		handlePostAnnounceAudio(
			await liveDomia(domia, bodyDomiaKey(request.body)),
			request.body,
		),
	)

	fastify.post("/config/refresh", async () => {
		invalidateOwnDomia()
		const fresh = await liveDomia(domia)
		setGrpcClientTunables(fresh)
		void sendHeartbeat({ domia: fresh })
		httpServerLogger.info("🔄 config cache invalidated via /config/refresh")
		return { refreshed: true }
	})

	fastify.get<GetSyncRouteType>("/sync", async (request) =>
		handleGetSync(
			await liveDomia(domia, queryDomiaKey(request.query)),
			request.query,
		),
	)

	fastify.get("/presence", async () => handleGetPresence())

	fastify.post("/turn/cancel", async (request) =>
		handlePostTurnCancel(await liveDomia(domia, bodyDomiaKey(request.body))),
	)

	fastify.post("/intercom", async (request) => handlePostIntercom(request.body))

	fastify.get("/mind", async (request) =>
		handleGetMind(await liveDomia(domia, queryDomiaKey(request.query))),
	)

	fastify.get("/config", async (request) =>
		handleGetConfig(await liveDomia(domia, queryDomiaKey(request.query))),
	)

	fastify.post("/config", async (request, reply) => {
		const key = queryDomiaKey(request.query)
		const live = await liveDomia(domia, key)
		const result = await handlePostConfig(live, request.body, reply)
		const fresh = await liveDomia(domia, key)
		void sendHeartbeat({ domia: fresh })
		return result
	})

	fastify.get("/config/health", async (request) =>
		handleGetConfigHealth(await liveDomia(domia, queryDomiaKey(request.query))),
	)

	fastify.get("/knowledge", async (request) =>
		handleGetKnowledge(await liveDomia(domia, queryDomiaKey(request.query))),
	)

	fastify.post("/knowledge", async (request, reply) =>
		handlePostKnowledge(
			await liveDomia(domia, queryDomiaKey(request.query)),
			request.body,
			reply,
		),
	)

	fastify.delete<{ Params: { id: string } }>(
		"/knowledge/:id",
		async (request) =>
			handleDeleteKnowledge(
				await liveDomia(domia, queryDomiaKey(request.query)),
				request.params.id,
			),
	)

	fastify.get("/stats/latency", async (request) =>
		handleGetLatencyStats(await liveDomia(domia, queryDomiaKey(request.query))),
	)

	fastify.post("/admin/restart", async () => {
		void sendHeartbeat({ domia: await liveDomia(domia) })
		return handleRestart()
	})

	fastify.get("/models", async (request) =>
		handleGetModels(await liveDomia(domia, queryDomiaKey(request.query))),
	)

	fastify.post("/models/install", async (request, reply) =>
		handlePostModelInstall(
			await liveDomia(domia, queryDomiaKey(request.query)),
			request.body,
			reply,
		),
	)

	fastify.get<{ Params: { id: string } }>(
		"/models/jobs/:id",
		async (request, reply) => handleGetModelJob(request.params.id, reply),
	)

	fastify.post<PostImportMindRouteType>(
		"/mind/import",
		async (request, reply) => {
			const live = await liveDomia(domia, queryDomiaKey(request.query))
			const result = await handleImportMind(live, request.body, reply)
			void sendHeartbeat({ domia: live })
			return result
		},
	)

	fastify.get("/templates", async () => handleGetTemplates())

	fastify.post<TemplateIdRouteType>(
		"/templates/:id/activate",
		async (request, reply) => {
			const live = await liveDomia(domia, queryDomiaKey(request.query))
			const result = await handleActivateTemplate(
				live,
				request.params.id,
				reply,
			)
			void sendHeartbeat({ domia: live })
			return result
		},
	)

	fastify.get("/identities", async () => handleGetIdentities())

	fastify.post("/identities", async (request, reply) =>
		handlePostIdentity(request.body, reply),
	)

	fastify.delete<{ Params: { domiaKey: string } }>(
		"/identities/:domiaKey",
		async (request, reply) =>
			handleDeleteIdentity(request.params.domiaKey, reply),
	)

	fastify.get("/satellites/discover", async () => handleDiscoverSatellites())

	fastify.get("/satellites", async (request, reply) =>
		handleGetSatellites(queryDomiaKey(request.query), reply),
	)

	fastify.post("/satellites", async (request, reply) =>
		handlePostSatellite(queryDomiaKey(request.query), request.body, reply),
	)

	fastify.delete<{ Params: { satelliteId: string } }>(
		"/satellites/:satelliteId",
		async (request, reply) =>
			handleDeleteSatellite(
				queryDomiaKey(request.query),
				request.params.satelliteId,
				reply,
			),
	)

	fastify.patch<{ Params: { satelliteId: string } }>(
		"/satellites/:satelliteId/wake-words",
		async (request, reply) =>
			handleSetSatelliteWakeWords(
				queryDomiaKey(request.query),
				request.params.satelliteId,
				request.body,
				reply,
			),
	)

	fastify.patch<{ Params: { satelliteId: string } }>(
		"/satellites/:satelliteId/numbers",
		async (request, reply) =>
			handleSetSatelliteNumber(
				queryDomiaKey(request.query),
				request.params.satelliteId,
				request.body,
				reply,
			),
	)

	fastify.patch<{ Params: { satelliteId: string } }>(
		"/satellites/:satelliteId/follow-up",
		async (request, reply) =>
			handleSetSatelliteFollowUp(
				queryDomiaKey(request.query),
				request.params.satelliteId,
				request.body,
				reply,
			),
	)

	fastify.patch<{ Params: { satelliteId: string } }>(
		"/satellites/:satelliteId/volume",
		async (request, reply) =>
			handleSetSatelliteVolume(
				queryDomiaKey(request.query),
				request.params.satelliteId,
				request.body,
				reply,
			),
	)

	fastify.post<{ Params: { satelliteId: string } }>(
		"/satellites/:satelliteId/timers",
		async (request, reply) =>
			handleStartSatelliteTimer(
				queryDomiaKey(request.query),
				request.params.satelliteId,
				request.body,
				reply,
			),
	)

	fastify.get<{ Params: { satelliteId: string } }>(
		"/satellites/:satelliteId/timers",
		async (request, reply) =>
			handleListSatelliteTimers(
				queryDomiaKey(request.query),
				request.params.satelliteId,
				reply,
			),
	)

	fastify.delete<{ Params: { satelliteId: string; timerId: string } }>(
		"/satellites/:satelliteId/timers/:timerId",
		async (request, reply) =>
			handleCancelSatelliteTimer(
				queryDomiaKey(request.query),
				request.params.satelliteId,
				request.params.timerId,
				reply,
			),
	)

	fastify.post<{ Params: { satelliteId: string } }>(
		"/satellites/:satelliteId/test-speaker",
		async (request, reply) =>
			handleTestSatelliteSpeaker(
				queryDomiaKey(request.query),
				request.params.satelliteId,
				reply,
			),
	)

	setupSatelliteGateway(fastify.server, domia)

	try {
		await fastify.listen({ port: HTTP_SERVER_PORT, host: HTTP_SERVER_HOST })
		httpServerLogger.success(`✅ HTTP server ready on port ${HTTP_SERVER_PORT}`)
	} catch (err) {
		httpServerLogger.error("❌ Error starting HTTP server", { err })
		process.exit(1)
	}
}

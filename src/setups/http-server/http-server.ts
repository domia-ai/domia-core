import Fastify from "fastify"
import { httpServerLogger } from "@/utils"
import { env } from "@/config"

const HTTP_SERVER_HOST = env?.HTTP_SERVER_HOST
const HTTP_SERVER_PORT = Number(env?.HTTP_SERVER_PORT)

export const setupHttpServer = async () => {
	httpServerLogger.info("🚀 Starting HTTP server...")

	const fastify = Fastify({
		logger: false,
	})

	fastify.get("/", async () => {
		return { message: "DOMIA HTTP Server is running ✅" }
	})

	fastify.get("/health", async () => {
		return { status: "ok", timestamp: new Date().toISOString() }
	})

	try {
		await fastify.listen({ port: HTTP_SERVER_PORT, host: HTTP_SERVER_HOST })
		httpServerLogger.success(`✅ HTTP server ready on port ${HTTP_SERVER_PORT}`)
	} catch (err) {
		httpServerLogger.error("❌ Error starting HTTP server", { err })
		process.exit(1)
	}
}

import { createServer, type Server } from "nice-grpc"

import { env } from "@/config"
import { type DomiaType } from "@/modules/core"
import { grpcServerLogger } from "@/utils"
import { handleDeliverEvent } from "@/modules/grpc-event-handler"
import {
	DomiaNodeDefinition,
	type DomiaNodeServiceImplementation,
	type HealthResponse,
	type EventEnvelope,
	type DeliveryAck,
} from "@/generated/proto/domia"

let server: Server | null = null

const buildImplementation = (
	domia: DomiaType,
): DomiaNodeServiceImplementation => ({
	async health(): Promise<HealthResponse> {
		return {
			status: "ok",
			domiaId: domia.id,
			domiaKey: domia.domiaKey,
			serverTimeMs: Date.now(),
		}
	},
	async deliverEvent(envelope: EventEnvelope): Promise<DeliveryAck> {
		return handleDeliverEvent({ domia }, envelope)
	},
})

export const setupGrpcServer = async ({ domia }: { domia: DomiaType }) => {
	if (server) {
		grpcServerLogger.warn("gRPC server already running — skipping")
		return
	}

	server = createServer()
	server.add(DomiaNodeDefinition, buildImplementation(domia))

	const addr = `${env.GRPC_HOST}:${env.GRPC_PORT}`
	try {
		await server.listen(addr)
		grpcServerLogger.success(`✅ gRPC server ready on ${addr}`)
	} catch (err) {
		grpcServerLogger.error(`❌ gRPC server failed to start: ${err}`)
		server = null
		throw err
	}

	const cleanup = async () => {
		if (!server) return
		grpcServerLogger.info("shutting down gRPC server")
		try {
			await server.shutdown()
		} catch (err) {
			grpcServerLogger.warn(`gRPC server shutdown error: ${err}`)
		}
		server = null
	}
	process.once("SIGINT", cleanup)
	process.once("SIGTERM", cleanup)
	process.once("exit", () => {
		void cleanup()
	})
}

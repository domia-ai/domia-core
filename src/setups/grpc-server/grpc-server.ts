import { createServer, type Server } from "nice-grpc"

import { env } from "@/config"
import {
	grpcServerLogger,
	pcmChunksToWavFile,
	wavFileToPcmChunks,
} from "@/utils"
import { handleDeliverEvent } from "@/modules/grpc-event-handler"
import { resolveCoreBusFeatures } from "@/modules/core-bus"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import { runSTT } from "@/modules/stt-engine"
import { runLLM } from "@/modules/llm-engine"
import { runTTS } from "@/modules/tts-engine"
import {
	DomiaNodeDefinition,
	type DomiaNodeServiceImplementation,
	type HealthResponse,
	type EventEnvelope,
	type DeliveryAck,
	type AudioChunk,
	type SttDonePayload,
	type TokenChunk,
	type LlmStreamRequest,
	type TtsStreamRequest,
	type StreamSttMeta,
} from "@/generated/proto/domia"
import type { GrpcServerArgsType } from "./types"

let server: Server | null = null

const buildImplementation = ({
	domia,
	capabilities,
}: GrpcServerArgsType): DomiaNodeServiceImplementation => ({
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

	async streamStt(request: AsyncIterable<AudioChunk>): Promise<SttDonePayload> {
		const features = resolveCoreBusFeatures(domia, capabilities)
		const captured: { meta?: StreamSttMeta } = {}

		const pcm = (async function* (): AsyncIterable<Buffer> {
			for await (const chunk of request) {
				if (chunk.meta && !captured.meta) captured.meta = chunk.meta
				if (chunk.pcm && chunk.pcm.length > 0) yield Buffer.from(chunk.pcm)
			}
		})()

		let transcript: string
		if (features.canStreamStt && features.stt?.adapter.runStream) {
			transcript = await features.stt.adapter.runStream(domia, pcm)
		} else {
			const filePath = await pcmChunksToWavFile(
				pcm,
				captured.meta?.interactionId ?? "",
			)
			transcript = await runSTT(domia, filePath)
		}

		grpcServerLogger.info(`📥 streamStt → "${transcript}"`, {
			domiaId: domia.id,
			interactionId: captured.meta?.interactionId,
		})
		return {
			transcript,
			interactionId: captured.meta?.interactionId,
			originDomiaKey: captured.meta?.originDomiaKey,
			responseType: captured.meta?.responseType,
		}
	},

	async *streamLlm(request: LlmStreamRequest): AsyncIterable<TokenChunk> {
		const features = resolveCoreBusFeatures(domia, capabilities)
		const promptContext = buildPromptContext(domia, request.transcript)

		if (features.canStreamLlm && features.llm?.adapter.runStream) {
			for await (const token of features.llm.adapter.runStream(
				domia,
				promptContext,
			)) {
				yield { token }
			}
			return
		}

		const reply = await runLLM(domia, promptContext)
		yield { token: reply }
	},

	async *streamTts(request: TtsStreamRequest): AsyncIterable<AudioChunk> {
		const features = resolveCoreBusFeatures(domia, capabilities)
		const caps = features.tts?.adapter.capabilities
		const sampleRate = caps?.sampleRate ?? 24000
		const channels = caps?.channels ?? 1

		if (features.canStreamTts && features.tts?.adapter.runStream) {
			for await (const buf of features.tts.adapter.runStream(
				domia,
				request.reply,
			)) {
				yield { pcm: buf, sampleRate, channels }
			}
			return
		}

		const result = await runTTS(domia, request.reply)
		if (!result?.filePath) return
		for await (const chunk of wavFileToPcmChunks(result.filePath)) {
			yield { pcm: chunk, sampleRate, channels }
		}
	},
})

export const setupGrpcServer = async ({
	domia,
	capabilities,
}: GrpcServerArgsType) => {
	if (server) {
		grpcServerLogger.warn("gRPC server already running — skipping")
		return
	}

	server = createServer()
	server.add(DomiaNodeDefinition, buildImplementation({ domia, capabilities }))

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

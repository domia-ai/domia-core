import { createServer, type Server } from "nice-grpc"

import { env } from "@/config"
import { grpcServerLogger, pcmChunksToWavFile } from "@/utils"
import { handleDeliverEvent } from "@/modules/grpc-event-handler"
import { resolveCoreBusFeatures } from "@/modules/core-bus"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import { runSTT } from "@/modules/stt-engine"
import { runLLM } from "@/modules/llm-engine"
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
	type ReplyAudioMessage,
} from "@/generated/proto/domia"
import type { GrpcServerArgsType } from "./types"
import {
	bytesToAudioMs,
	canPipelineReply,
	canStreamLlm,
	canStreamTts,
	fullReplyChunks,
	pipelinedReplyChunks,
	ttsCapsOrDefaults,
	ttsTextToChunks,
} from "./utils"

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

		const transcript =
			features.canStreamStt && features.stt?.adapter.runStream
				? await features.stt.adapter.runStream(domia, pcm)
				: await runSTT(
						domia,
						await pcmChunksToWavFile(pcm, captured.meta?.interactionId ?? ""),
					)

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
		const runStream = features.llm?.adapter.runStream

		if (canStreamLlm(features) && runStream) {
			for await (const token of runStream(domia, promptContext)) {
				yield { token }
			}
			return
		}

		const reply = await runLLM(domia, promptContext)
		yield { token: reply }
	},

	async *streamTts(request: TtsStreamRequest): AsyncIterable<AudioChunk> {
		const features = resolveCoreBusFeatures(domia, capabilities)
		const { sampleRate, channels } = ttsCapsOrDefaults(features)
		const streaming = canStreamTts(features)
		const startedAt = Date.now()
		let chunkCount = 0
		let totalBytes = 0

		grpcServerLogger.info(`📤 streamTts ← "${request.reply.slice(0, 80)}…"`, {
			interactionId: request.interactionId,
			originDomiaKey: request.originDomiaKey,
			replyLen: request.reply.length,
			streaming,
		})

		try {
			for await (const chunk of ttsTextToChunks(
				domia,
				request.reply,
				features,
			)) {
				chunkCount++
				totalBytes += chunk.length
				yield { pcm: chunk, sampleRate, channels }
			}
		} finally {
			grpcServerLogger.info(`📤 streamTts ended`, {
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
				chunkCount,
				totalBytes,
				durationMs: Date.now() - startedAt,
				approxAudioMs: bytesToAudioMs(totalBytes, sampleRate, channels),
				sampleRate,
			})
		}
	},

	async *streamReplyAudio(
		request: LlmStreamRequest,
	): AsyncIterable<ReplyAudioMessage> {
		const features = resolveCoreBusFeatures(domia, capabilities)
		const { sampleRate, channels } = ttsCapsOrDefaults(features)
		const pipelined = canPipelineReply(features)
		const startedAt = Date.now()
		let chunkCount = 0
		let totalBytes = 0
		let firstChunkAt: number | null = null
		let sentenceCount = 0
		let assembled = ""

		grpcServerLogger.info(
			`📤 streamReplyAudio ← "${request.transcript.slice(0, 80)}…"`,
			{
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
				pipelined,
				ttsMode: canStreamTts(features) ? "stream" : "sync",
			},
		)

		try {
			const promptContext = buildPromptContext(domia, request.transcript)
			const onSentence = (sentence: string): void => {
				sentenceCount++
				assembled += (assembled.length > 0 ? " " : "") + sentence
			}
			const onReply = (reply: string): void => {
				assembled = reply
			}
			const audio = pipelined
				? pipelinedReplyChunks(domia, promptContext, features, onSentence)
				: fullReplyChunks(domia, promptContext, features, onReply)

			for await (const chunk of audio) {
				chunkCount++
				totalBytes += chunk.length
				if (firstChunkAt === null) firstChunkAt = Date.now()
				yield {
					payload: {
						$case: "audio",
						audio: { pcm: chunk, sampleRate, channels },
					},
				}
			}

			yield {
				payload: { $case: "finalReply", finalReply: assembled },
			}
		} finally {
			grpcServerLogger.info(`📤 streamReplyAudio ended`, {
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
				pipelined,
				sentenceCount,
				chunkCount,
				totalBytes,
				ttfaMs: firstChunkAt !== null ? firstChunkAt - startedAt : null,
				durationMs: Date.now() - startedAt,
				approxAudioMs: bytesToAudioMs(totalBytes, sampleRate, channels),
				replyLen: assembled.length,
			})
		}
	},
})

export const setupGrpcServer = async ({
	domia,
	capabilities,
}: GrpcServerArgsType): Promise<void> => {
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

	const cleanup = async (): Promise<void> => {
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

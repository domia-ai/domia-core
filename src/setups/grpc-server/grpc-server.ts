import { createServer, type Server } from "nice-grpc"

import { env } from "@/config"
import { grpcServerLogger, setTraceContext } from "@/utils"
import { resolveLiveDomia } from "@/setups/live-domia"
import { handleDeliverEvent } from "@/modules/grpc-event-handler"
import { closeAllChannels } from "@/modules/grpc-client"
import { buildPromptFromPersona } from "@/modules/prompt-context-builder"
import { applyMoodDelta, emotionPartialSchema } from "@/modules/emotion-engine"
import { parseFacts, upsertFacts } from "@/modules/memory"
import { updateInteraction } from "@/modules/session-manager"
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
	type ReplyAudioMessage,
	type ReflectionReport,
	type ReflectionAck,
	type StageExecutionReport,
	type StageExecutionAck,
} from "@/generated/proto/domia"
import type { GrpcServerArgsType } from "./types"
import {
	bytesToAudioMs,
	canStreamLlm,
	ttsCapsOrDefaults,
	ttsTextToChunks,
	transcribeAudioStream,
	streamReplyAudioMessages,
	resolvePersonaContext,
	resolveTtsVoiceOptions,
	reflectOnPersonaInteraction,
	reportStageExecution,
	admitVoiceReplyOrBusy,
} from "./utils"

let server: Server | null = null

const buildImplementation = ({
	domia: bootDomia,
	capabilities: bootCapabilities,
}: GrpcServerArgsType): DomiaNodeServiceImplementation => {
	const resolveLive = () => resolveLiveDomia(bootDomia, bootCapabilities)

	return {
		async health(): Promise<HealthResponse> {
			const { domia } = await resolveLive()
			return {
				status: "ok",
				domiaId: domia.id,
				domiaKey: domia.domiaKey,
				serverTimeMs: Date.now(),
			}
		},

		async deliverEvent(envelope: EventEnvelope): Promise<DeliveryAck> {
			const { domia } = await resolveLive()
			return handleDeliverEvent({ domia }, envelope)
		},

		async streamStt(
			request: AsyncIterable<AudioChunk>,
		): Promise<SttDonePayload> {
			const { domia, features } = await resolveLive()
			if (!features.canRunStt) {
				throw new Error("stt capability disabled on this domia")
			}
			try {
				const sttStart = Date.now()
				const { transcript, meta } = await transcribeAudioStream(
					domia,
					request,
					features,
				)
				setTraceContext({
					interactionId: meta?.interactionId,
					originDomiaKey: meta?.originDomiaKey,
				})
				grpcServerLogger.info(`📥 streamStt → "${transcript}"`, {
					domiaId: domia.id,
					interactionId: meta?.interactionId,
				})
				void reportStageExecution(
					domia,
					meta?.originDomiaKey,
					meta?.interactionId,
					[
						{
							stage: "stt",
							executorDomiaKey: domia.domiaKey,
							stageMs: Date.now() - sttStart,
							model: domia.sttConfig?.modelName,
							engine: domia.sttConfig?.engine,
						},
					],
				)
				return {
					transcript,
					interactionId: meta?.interactionId,
					originDomiaKey: meta?.originDomiaKey,
					responseType: meta?.responseType,
				}
			} catch (err) {
				grpcServerLogger.error("❌ streamStt failed", { err })
				throw err
			}
		},

		async *streamLlm(request: LlmStreamRequest): AsyncIterable<TokenChunk> {
			setTraceContext({
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
			})
			const { domia, features } = await resolveLive()
			if (!features.canRunLlm) {
				throw new Error("llm capability disabled on this domia")
			}
			const persona = resolvePersonaContext(request.personaContextJson, domia)
			const promptContext = buildPromptFromPersona(persona, request.transcript)
			const runStream = features.llm?.adapter.runStream
			let reply = ""
			const llmStart = Date.now()

			try {
				if (canStreamLlm(features) && runStream) {
					for await (const token of runStream(domia, promptContext)) {
						reply += token
						yield { token }
					}
				} else {
					reply = await runLLM(domia, promptContext)
					yield { token: reply }
				}
			} catch (err) {
				grpcServerLogger.error("❌ streamLlm failed", { err })
				throw err
			}

			void reportStageExecution(
				domia,
				request.originDomiaKey,
				request.interactionId,
				[
					{
						stage: "llm",
						executorDomiaKey: domia.domiaKey,
						stageMs: Date.now() - llmStart,
						model: domia.llmModelConfig?.modelName,
						engine: domia.llmModelConfig?.engine,
					},
				],
			)
			void reflectOnPersonaInteraction(
				domia,
				persona,
				request.originDomiaKey,
				request.transcript,
				reply,
				request.interactionId,
			)
		},

		async *streamTts(request: TtsStreamRequest): AsyncIterable<AudioChunk> {
			setTraceContext({
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
			})
			const { domia, features } = await resolveLive()
			if (!features.canRunTts) {
				throw new Error("tts capability disabled on this domia")
			}
			const { sampleRate, channels } = ttsCapsOrDefaults(features)
			const ttsOptions = resolveTtsVoiceOptions(request.ttsVoiceJson)
			const streaming = !!features.tts?.adapter.runStream
			const startedAt = Date.now()
			let chunkCount = 0
			let totalBytes = 0

			grpcServerLogger.info(`📤 streamTts ← "${request.reply.slice(0, 80)}…"`, {
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
				replyLen: request.reply.length,
				streaming,
				voice: ttsOptions?.voice?.voiceName,
			})

			try {
				for await (const chunk of ttsTextToChunks(
					domia,
					request.reply,
					features,
					ttsOptions,
				)) {
					chunkCount++
					totalBytes += chunk.length
					yield { pcm: chunk, sampleRate, channels }
				}
			} catch (err) {
				grpcServerLogger.error("❌ streamTts failed", { err })
				throw err
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
				void reportStageExecution(
					domia,
					request.originDomiaKey,
					request.interactionId,
					[
						{
							stage: "tts",
							executorDomiaKey: domia.domiaKey,
							stageMs: Date.now() - startedAt,
							engine: domia.ttsConfig?.engine,
							voice: ttsOptions?.voice?.voiceName ?? domia.ttsConfig?.voiceName,
						},
					],
				)
			}
		},

		async *streamReplyAudio(
			request: LlmStreamRequest,
		): AsyncIterable<ReplyAudioMessage> {
			setTraceContext({
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
			})
			const { domia, features } = await resolveLive()
			if (!features.canRunLlm || !features.canRunTts) {
				throw new Error("llm+tts capabilities required for streamReplyAudio")
			}
			const release = await admitVoiceReplyOrBusy(domia, {
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
			})
			try {
				const persona = resolvePersonaContext(request.personaContextJson, domia)
				yield* streamReplyAudioMessages(
					domia,
					persona,
					request.transcript,
					features,
					{
						label: "streamReplyAudio",
						interactionId: request.interactionId,
						originDomiaKey: request.originDomiaKey,
					},
				)
			} catch (err) {
				grpcServerLogger.error("❌ streamReplyAudio failed", { err })
				throw err
			} finally {
				release()
			}
		},

		async *streamVoiceReply(
			request: AsyncIterable<AudioChunk>,
		): AsyncIterable<ReplyAudioMessage> {
			const { domia, features } = await resolveLive()
			if (!features.canRunStt || !features.canRunLlm || !features.canRunTts) {
				throw new Error(
					"stt+llm+tts capabilities required for streamVoiceReply",
				)
			}
			const release = await admitVoiceReplyOrBusy(domia, {})
			try {
				const sttStart = Date.now()
				const { transcript, meta } = await transcribeAudioStream(
					domia,
					request,
					features,
				)
				setTraceContext({
					interactionId: meta?.interactionId,
					originDomiaKey: meta?.originDomiaKey,
				})
				grpcServerLogger.info(`📥 streamVoiceReply STT → "${transcript}"`, {
					domiaId: domia.id,
					interactionId: meta?.interactionId,
				})
				void reportStageExecution(
					domia,
					meta?.originDomiaKey,
					meta?.interactionId,
					[
						{
							stage: "stt",
							executorDomiaKey: domia.domiaKey,
							stageMs: Date.now() - sttStart,
							model: domia.sttConfig?.modelName,
							engine: domia.sttConfig?.engine,
						},
					],
				)

				const persona = resolvePersonaContext(meta?.personaContextJson, domia)
				yield { payload: { $case: "transcript", transcript } }
				yield* streamReplyAudioMessages(domia, persona, transcript, features, {
					label: "streamVoiceReply",
					interactionId: meta?.interactionId,
					originDomiaKey: meta?.originDomiaKey,
				})
			} catch (err) {
				grpcServerLogger.error("❌ streamVoiceReply failed", { err })
				throw err
			} finally {
				release()
			}
		},

		async reportReflection(request: ReflectionReport): Promise<ReflectionAck> {
			setTraceContext({ interactionId: request.interactionId })
			const { domia } = await resolveLive()
			if (request.originDomiaKey && request.originDomiaKey !== domia.domiaKey) {
				grpcServerLogger.warn(
					"⚠️ reflection report misrouted — origin mismatch, rejecting",
					{ origin: request.originDomiaKey, self: domia.domiaKey },
				)
				return { accepted: false }
			}
			try {
				if (request.emotionDeltaJson) {
					try {
						const parsed = emotionPartialSchema.safeParse(
							JSON.parse(request.emotionDeltaJson),
						)
						if (parsed.success)
							applyMoodDelta(domia, parsed.data, request.cause)
						else
							grpcServerLogger.warn("⚠️ reflection emotion delta invalid", {
								issues: parsed.error.issues,
							})
					} catch (err) {
						grpcServerLogger.warn("⚠️ reflection emotion delta unparseable", {
							err,
						})
					}
				}
				if (request.factsJson) {
					try {
						const facts = parseFacts(JSON.parse(request.factsJson))
						await upsertFacts(domia, facts, request.interactionId)
					} catch (err) {
						grpcServerLogger.warn("⚠️ reflection facts failed", { err })
					}
				}
				if (request.userEmotionJson && request.interactionId) {
					try {
						await updateInteraction({
							id: request.interactionId,
							userEmotionSnapshot: JSON.parse(request.userEmotionJson),
						})
					} catch (err) {
						grpcServerLogger.warn("⚠️ reflection user emotion failed", { err })
					}
				}
				return { accepted: true }
			} catch (err) {
				grpcServerLogger.error("❌ reportReflection failed", { err })
				return { accepted: false }
			}
		},

		async reportStageExecution(
			request: StageExecutionReport,
		): Promise<StageExecutionAck> {
			setTraceContext({ interactionId: request.interactionId })
			const id = request.interactionId
			if (!id) return { accepted: false }
			const { domia } = await resolveLive()
			if (request.originDomiaKey && request.originDomiaKey !== domia.domiaKey) {
				grpcServerLogger.warn(
					"⚠️ stage report misrouted — origin mismatch, rejecting",
					{ origin: request.originDomiaKey, self: domia.domiaKey },
				)
				return { accepted: false }
			}
			try {
				for (const m of request.stages) {
					if (m.stage === "stt") {
						await updateInteraction({
							id,
							sttMs: m.stageMs,
							sttModelUsed: m.model ?? null,
							sttExecutorKey: m.executorDomiaKey,
						})
					} else if (m.stage === "llm") {
						await updateInteraction({
							id,
							llmMs: m.stageMs,
							llmModelUsed: m.model ?? null,
							llmExecutorKey: m.executorDomiaKey,
						})
					} else if (m.stage === "tts") {
						await updateInteraction({
							id,
							ttsMs: m.stageMs,
							ttsEngineUsed: m.engine ?? null,
							ttsVoiceUsed: m.voice ?? null,
							ttsExecutorKey: m.executorDomiaKey,
						})
					}
				}
				return { accepted: true }
			} catch (err) {
				grpcServerLogger.error("❌ reportStageExecution failed", { err })
				return { accepted: false }
			}
		},
	}
}

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
		closeAllChannels()
		server = null
	}
	process.once("SIGINT", cleanup)
	process.once("SIGTERM", cleanup)
	process.once("exit", () => {
		void cleanup()
	})
}

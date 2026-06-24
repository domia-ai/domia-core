import { createServer, type Server } from "nice-grpc"

import { env } from "@/config"
import { grpcServerLogger, setTraceContext } from "@/utils"
import { resolveLiveDomia, resolveLiveIdentity } from "@/setups/live-domia"
import { getOwnDomia, isHostedIdentity } from "@/modules/core"
import { speak as speakOnDomia } from "@/modules/core-bus"
import { handleDeliverEvent } from "@/modules/grpc-event-handler"
import { closeAllChannels, setLocalService } from "@/modules/grpc-client"
import { buildPromptFromPersona } from "@/modules/prompt-context-builder"
import { applyMoodDelta, emotionPartialSchema } from "@/modules/emotion-engine"
import { parseFacts, upsertFacts } from "@/modules/memory"
import { updateInteraction } from "@/modules/session-manager"
import { runLLM, runLLMWithTools } from "@/modules/llm-engine"
import type {
	ChatMessageType,
	ToolDefinitionType,
	LlmUsageType,
	LlmUsageSinkType,
} from "@/modules/llm-engine"
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
	type InferenceRequest,
	type InferenceResponse,
	type SpeakRequest,
	type SpeakAck,
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
	reportStageExecution,
	admitVoiceReplyOrBusy,
} from "./utils"

let server: Server | null = null

const buildImplementation = ({
	domia: bootDomia,
	capabilities: bootCapabilities,
}: GrpcServerArgsType): DomiaNodeServiceImplementation => {
	const resolveLive = () => resolveLiveDomia(bootDomia, bootCapabilities)
	const resolveTarget = (targetDomiaKey?: string) =>
		resolveLiveIdentity(bootDomia, bootCapabilities, targetDomiaKey)

	const originKeyOf = (envelope: EventEnvelope): string | undefined => {
		const p = envelope.payload
		if (!p?.$case) return undefined
		switch (p.$case) {
			case "audioReady":
				return p.audioReady.originDomiaKey
			case "sttDone":
				return p.sttDone.originDomiaKey
			case "llmDone":
				return p.llmDone.originDomiaKey
			case "ttsDone":
				return p.ttsDone.originDomiaKey
			case "interactionFailed":
				return p.interactionFailed.originDomiaKey
		}
	}

	const peekAudioTarget = async (
		request: AsyncIterable<AudioChunk>,
	): Promise<{
		targetDomiaKey?: string
		stream: AsyncIterable<AudioChunk>
	}> => {
		const iterator = request[Symbol.asyncIterator]()
		const first = await iterator.next()
		const targetDomiaKey = first.value?.meta?.targetDomiaKey
		const stream = (async function* (): AsyncIterable<AudioChunk> {
			if (!first.done) yield first.value as AudioChunk
			while (true) {
				const next = await iterator.next()
				if (next.done) break
				yield next.value
			}
		})()
		return { targetDomiaKey, stream }
	}

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
			const { domia } = await resolveTarget(
				envelope.targetDomiaKey || originKeyOf(envelope),
			)
			return handleDeliverEvent({ domia }, envelope)
		},

		async streamStt(
			request: AsyncIterable<AudioChunk>,
		): Promise<SttDonePayload> {
			const { targetDomiaKey, stream } = await peekAudioTarget(request)
			const { domia, features } = await resolveTarget(targetDomiaKey)
			if (!features.canRunStt) {
				throw new Error("stt capability disabled on this domia")
			}
			try {
				const sttStart = Date.now()
				let sttExecMs: number | null = null
				const { transcript, meta } = await transcribeAudioStream(
					domia,
					stream,
					features,
					(t) => {
						sttExecMs = t.execMs
					},
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
							stageMs: sttExecMs ?? Date.now() - sttStart,
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
			const { domia, features } = await resolveTarget(request.targetDomiaKey)
			if (!features.canRunLlm) {
				throw new Error("llm capability disabled on this domia")
			}
			const persona = resolvePersonaContext(request.personaContextJson, domia)
			const promptContext = buildPromptFromPersona(persona, request.transcript)
			const runStream = features.llm?.adapter.runStream
			let reply = ""
			const llmStart = Date.now()
			const llmUsageRef: { current: LlmUsageType | null } = { current: null }
			const onLlmUsage: LlmUsageSinkType = (u) => {
				llmUsageRef.current = u
			}

			try {
				if (canStreamLlm(features) && runStream) {
					for await (const token of runStream(
						domia,
						promptContext,
						undefined,
						onLlmUsage,
					)) {
						reply += token
						yield { token }
					}
				} else {
					reply = await runLLM(domia, promptContext, onLlmUsage)
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
						promptTokens: llmUsageRef.current?.promptTokens ?? undefined,
						completionTokens:
							llmUsageRef.current?.completionTokens ?? undefined,
						tokensPerSec: llmUsageRef.current?.tokensPerSec ?? undefined,
						ttftMs: llmUsageRef.current?.ttftMs ?? undefined,
						contextWindow: llmUsageRef.current?.contextWindow ?? undefined,
						finishReason: llmUsageRef.current?.finishReason ?? undefined,
					},
				],
			)
		},

		async *streamTts(request: TtsStreamRequest): AsyncIterable<AudioChunk> {
			setTraceContext({
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
			})
			const { domia, features } = await resolveTarget(request.targetDomiaKey)
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
			const { domia, features } = await resolveTarget(request.targetDomiaKey)
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
			const { targetDomiaKey, stream } = await peekAudioTarget(request)
			const { domia, features } = await resolveTarget(targetDomiaKey)
			if (!features.canRunStt || !features.canRunLlm || !features.canRunTts) {
				throw new Error(
					"stt+llm+tts capabilities required for streamVoiceReply",
				)
			}
			const release = await admitVoiceReplyOrBusy(domia, {})
			try {
				const sttStart = Date.now()
				let sttExecMs: number | null = null
				const { transcript, meta } = await transcribeAudioStream(
					domia,
					stream,
					features,
					(t) => {
						sttExecMs = t.execMs
					},
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
							stageMs: sttExecMs ?? Date.now() - sttStart,
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
			const { domia } = await resolveTarget(request.originDomiaKey)
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
			const { domia } = await resolveTarget(request.originDomiaKey)
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
							llmPromptTokens: m.promptTokens ?? null,
							llmCompletionTokens: m.completionTokens ?? null,
							llmTokensPerSec: m.tokensPerSec ?? null,
							llmTtftMs: m.ttftMs ?? null,
							llmContextWindow: m.contextWindow ?? null,
							llmFinishReason: m.finishReason ?? null,
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

		async runInferenceWithTools(
			request: InferenceRequest,
		): Promise<InferenceResponse> {
			setTraceContext({
				interactionId: request.interactionId,
				originDomiaKey: request.originDomiaKey,
			})
			const { domia, features } = await resolveTarget(request.targetDomiaKey)
			if (!features.canRunLlm) {
				throw new Error("llm capability disabled on this domia")
			}
			const messages = JSON.parse(request.messagesJson) as ChatMessageType[]
			const tools = JSON.parse(request.toolsJson) as ToolDefinitionType[]
			grpcServerLogger.info("🛠️ RunInferenceWithTools (hub inference only)", {
				toolCount: tools.length,
				model: domia.llmModelConfig?.modelName,
				origin: request.originDomiaKey,
			})
			const out = await runLLMWithTools(domia, messages, tools)
			if (out.kind === "reply") return { reply: out.text }
			return { toolCallsJson: JSON.stringify(out.calls) }
		},

		async speak(request: SpeakRequest): Promise<SpeakAck> {
			if (!isHostedIdentity(request.targetDomiaKey)) {
				grpcServerLogger.warn("📢 Speak: identity not hosted", {
					targetDomiaKey: request.targetDomiaKey,
				})
				return { delivered: false, target: "unknown" }
			}
			const target = await getOwnDomia(request.targetDomiaKey).catch(() => null)
			if (!target) {
				grpcServerLogger.warn("📢 Speak: unknown target identity", {
					targetDomiaKey: request.targetDomiaKey,
				})
				return { delivered: false, target: "unknown" }
			}
			setTraceContext({ originDomiaKey: target.domiaKey })
			const result = await speakOnDomia(target, request.text)
			grpcServerLogger.info(`📢 Speak → ${result.target}`, {
				targetDomiaKey: target.domiaKey,
				delivered: result.delivered,
			})
			return { delivered: result.delivered, target: result.target }
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
	const implementation = buildImplementation({ domia, capabilities })
	server.add(DomiaNodeDefinition, implementation)
	setLocalService(implementation)

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

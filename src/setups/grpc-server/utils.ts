import { ServerError, Status } from "nice-grpc"

import { type DomiaType, getDomiaByDomiaKey } from "@/modules/core"
import type { CoreBusFeaturesType } from "@/modules/core-bus/types"
import {
	splitSentences,
	AsyncQueue,
	concatStreams,
	eagerTtsSlotsFromDomia,
	pipelineDepthFromDomia,
	primeStream,
	sentenceTuningFromDomia,
} from "@/modules/core-bus/utils/sentence-buffer"
import { resolveFallbackMessage } from "@/modules/core-bus/utils/fallback-messages"
import {
	buildPromptFromPersona,
	personaContextFromDomia,
	personaContextSchema,
	ttsVoiceSchema,
	type PersonaContextType,
} from "@/modules/prompt-context-builder"
import {
	admitVoiceReply,
	activeVoiceReplies,
	queuedVoiceReplies,
} from "@/modules/voice-admission"
import { reportStageExecutionToTarget } from "@/modules/grpc-client"
import type { StageMetric } from "@/generated/proto/domia"
import { resolveDomiaStreamingCapabilities } from "@/modules/capability-resolver"
import {
	runLLM,
	type LlmUsageType,
	type LlmUsageSinkType,
} from "@/modules/llm-engine"
import { runSTT } from "@/modules/stt-engine"
import type { PoolJobTimingCbType } from "@/modules/inference-pool"
import {
	runTTS,
	ttsAdapterToPcmChunks,
	type RunTtsOptionsType,
} from "@/modules/tts-engine"
import {
	grpcServerLogger,
	pcmChunksToWavFile,
	wavFileToPcmChunks,
	isSemaphoreBusyError,
} from "@/utils"
import type {
	AudioChunk,
	ReplyAudioMessage,
	StreamSttMeta,
} from "@/generated/proto/domia"
import { HUB_AT_CAPACITY_DETAIL } from "./constants"
import {
	DEFAULT_CHANNELS,
	DEFAULT_SAMPLE_RATE,
} from "@/modules/core-bus/utils/playback"

export const admitVoiceReplyOrBusy = async (
	domia: DomiaType,
	logCtx: { interactionId?: string; originDomiaKey?: string },
): Promise<() => void> => {
	const release = await admitVoiceReply(domia).catch((err: unknown) => {
		if (isSemaphoreBusyError(err)) return null
		throw err
	})
	if (release) return release

	grpcServerLogger.warn(
		"🚧 hub at capacity — rejecting voice reply (too many concurrent)",
		{
			domiaId: domia?.id,
			...logCtx,
			active: activeVoiceReplies(),
			queued: queuedVoiceReplies(),
		},
	)
	throw new ServerError(Status.RESOURCE_EXHAUSTED, HUB_AT_CAPACITY_DETAIL)
}

export const resolvePersonaContext = (
	personaContextJson: string | undefined,
	fallback: DomiaType,
): PersonaContextType => {
	if (personaContextJson) {
		try {
			return personaContextSchema.parse(JSON.parse(personaContextJson))
		} catch (err) {
			grpcServerLogger.warn(
				"⚠️ invalid persona_context_json — responder falling back to its OWN persona (delegation persona leak)",
				{ err },
			)
			return personaContextFromDomia(fallback)
		}
	}
	grpcServerLogger.warn(
		"⚠️ missing persona_context_json — responder falling back to its OWN persona (delegation persona leak)",
	)
	return personaContextFromDomia(fallback)
}

export const resolveTtsVoiceOptions = (
	ttsVoiceJson: string | undefined,
): RunTtsOptionsType | undefined => {
	if (!ttsVoiceJson) return undefined
	try {
		return { voice: ttsVoiceSchema.parse(JSON.parse(ttsVoiceJson)) }
	} catch (err) {
		grpcServerLogger.warn(
			"⚠️ invalid tts_voice_json — responder falling back to its OWN voice",
			{ err },
		)
		return undefined
	}
}

export const reportStageExecution = async (
	responder: DomiaType,
	originDomiaKey: string | undefined,
	interactionId: string | undefined,
	stages: StageMetric[],
): Promise<void> => {
	try {
		if (!originDomiaKey || originDomiaKey === responder.domiaKey) return
		if (!interactionId || stages.length === 0) return
		const origin = await getDomiaByDomiaKey(originDomiaKey)
		if (!origin) return
		await reportStageExecutionToTarget(
			responder.domiaKey,
			{
				domiaKey: origin.domiaKey,
				domiaId: origin.id,
				localIp: origin.localIp,
				grpcPort: origin.grpcPort,
				source: "explicit",
				streamingCapabilities: resolveDomiaStreamingCapabilities(origin),
			},
			{ originDomiaKey, interactionId, stages },
		)
	} catch (err) {
		grpcServerLogger.warn("reportStageExecution failed (skipping)", {
			responderId: responder?.id,
			err,
		})
	}
}

export const canStreamTts = (features: CoreBusFeaturesType): boolean =>
	!!(features.canStreamTts && features.tts?.adapter.runStream)

export const canStreamLlm = (features: CoreBusFeaturesType): boolean =>
	!!(features.canStreamLlm && features.llm?.adapter.runStream)

export const canPipelineReply = (features: CoreBusFeaturesType): boolean =>
	canStreamLlm(features) &&
	(canStreamTts(features) ||
		(features.canRunTts && !!features.tts?.adapter.run))

export const ttsCapsOrDefaults = (
	features: CoreBusFeaturesType,
): { sampleRate: number; channels: number } => ({
	sampleRate:
		features.tts?.adapter.capabilities.sampleRate ?? DEFAULT_SAMPLE_RATE,
	channels: features.tts?.adapter.capabilities.channels ?? DEFAULT_CHANNELS,
})

export const bytesToAudioMs = (
	bytes: number,
	sampleRate: number,
	channels: number,
): number => Math.round((bytes / (sampleRate * channels * 2)) * 1000)

export const ttsTextToChunks = async function* (
	domia: DomiaType,
	text: string,
	features: CoreBusFeaturesType,
	options?: RunTtsOptionsType,
): AsyncIterable<Buffer> {
	const adapter = features.tts?.adapter
	if (adapter) {
		yield* ttsAdapterToPcmChunks(domia, adapter, text, options)
		return
	}
	const result = await runTTS(domia, text, options)
	if (!result?.filePath) return
	yield* wavFileToPcmChunks(result.filePath)
}

export const pipelinedReplyChunks = async function* (
	domia: DomiaType,
	promptContext: string,
	features: CoreBusFeaturesType,
	onSentence: (sentence: string) => void,
	options?: RunTtsOptionsType,
	onUsage?: LlmUsageSinkType,
): AsyncIterable<Buffer> {
	const llmRunStream = features.llm?.adapter.runStream
	if (!llmRunStream) return
	const tokens = llmRunStream(domia, promptContext, undefined, onUsage)
	const ttsQueue = new AsyncQueue<AsyncIterable<Buffer>>()
	const queueDepth = pipelineDepthFromDomia(domia)
	const eagerSlots = eagerTtsSlotsFromDomia(domia)
	let consumerClosed = false
	const producer = (async () => {
		try {
			for await (const sentence of splitSentences(
				tokens,
				sentenceTuningFromDomia(domia),
			)) {
				if (consumerClosed) break
				await ttsQueue.waitForSpace(queueDepth)
				if (consumerClosed) break
				onSentence(sentence)
				ttsQueue.push(
					primeStream(
						ttsTextToChunks(domia, sentence, features, options),
						eagerSlots,
					),
				)
			}
		} finally {
			ttsQueue.close()
		}
	})()
	try {
		yield* concatStreams(ttsQueue.iter())
	} finally {
		consumerClosed = true
		ttsQueue.close()
		await producer.catch(() => undefined)
	}
}

export const fullReplyChunks = async function* (
	domia: DomiaType,
	promptContext: string,
	features: CoreBusFeaturesType,
	onReply: (reply: string) => void,
	options?: RunTtsOptionsType,
	onUsage?: LlmUsageSinkType,
): AsyncIterable<Buffer> {
	const reply = await runLLM(domia, promptContext, onUsage)
	onReply(reply)
	yield* ttsTextToChunks(domia, reply, features, options)
}

export const transcribeAudioStream = async (
	domia: DomiaType,
	request: AsyncIterable<AudioChunk>,
	features: CoreBusFeaturesType,
	onSttTiming?: PoolJobTimingCbType,
): Promise<{ transcript: string; meta?: StreamSttMeta }> => {
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
					await pcmChunksToWavFile(
						pcm,
						() => captured.meta?.interactionId ?? "",
					),
					onSttTiming,
				)

	return { transcript, meta: captured.meta }
}

export const streamReplyAudioMessages = async function* (
	domia: DomiaType,
	persona: PersonaContextType,
	transcript: string,
	features: CoreBusFeaturesType,
	logCtx: { label: string; interactionId?: string; originDomiaKey?: string },
): AsyncIterable<ReplyAudioMessage> {
	const { sampleRate, channels } = ttsCapsOrDefaults(features)
	const ttsOptions: RunTtsOptionsType | undefined = persona.ttsVoice
		? { voice: persona.ttsVoice }
		: undefined
	const pipelined = canPipelineReply(features)
	const startedAt = Date.now()
	let chunkCount = 0
	let totalBytes = 0
	let firstChunkAt: number | null = null
	let llmDoneAt: number | null = null
	let sentenceCount = 0
	let assembled = ""
	const usageRef: { current: LlmUsageType | null } = { current: null }
	const onUsage: LlmUsageSinkType = (u) => {
		usageRef.current = u
	}

	grpcServerLogger.info(`📤 ${logCtx.label} ← "${transcript.slice(0, 80)}…"`, {
		interactionId: logCtx.interactionId,
		originDomiaKey: logCtx.originDomiaKey,
		pipelined,
		ttsMode: features.tts?.adapter.runStream ? "stream" : "sync",
		voice: ttsOptions?.voice?.voiceName,
	})

	try {
		const onSentence = (sentence: string): void => {
			sentenceCount++
			assembled += (assembled.length > 0 ? " " : "") + sentence
			llmDoneAt = Date.now()
		}
		const onReply = (reply: string): void => {
			assembled = reply
			llmDoneAt = Date.now()
		}

		const emptyTranscript = !transcript?.trim()
		let audio: AsyncIterable<Buffer>
		if (emptyTranscript) {
			grpcServerLogger.warn(
				`⚠️ ${logCtx.label}: empty transcript — speaking STT fallback (skipping LLM)`,
				{
					interactionId: logCtx.interactionId,
					originDomiaKey: logCtx.originDomiaKey,
				},
			)
			assembled = resolveFallbackMessage("stt")
			audio = ttsTextToChunks(domia, assembled, features, ttsOptions)
		} else {
			const promptContext = buildPromptFromPersona(persona, transcript)
			audio = pipelined
				? pipelinedReplyChunks(
						domia,
						promptContext,
						features,
						onSentence,
						ttsOptions,
						onUsage,
					)
				: fullReplyChunks(
						domia,
						promptContext,
						features,
						onReply,
						ttsOptions,
						onUsage,
					)
		}

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

		if (!emptyTranscript && !assembled.trim()) {
			grpcServerLogger.warn(
				`⚠️ ${logCtx.label}: empty LLM reply — speaking LLM fallback`,
				{
					interactionId: logCtx.interactionId,
					originDomiaKey: logCtx.originDomiaKey,
				},
			)
			assembled = resolveFallbackMessage("llm")
			for await (const chunk of ttsTextToChunks(
				domia,
				assembled,
				features,
				ttsOptions,
			)) {
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
		}

		yield { payload: { $case: "finalReply", finalReply: assembled } }
	} finally {
		grpcServerLogger.info(`📤 ${logCtx.label} ended`, {
			interactionId: logCtx.interactionId,
			originDomiaKey: logCtx.originDomiaKey,
			pipelined,
			sentenceCount,
			chunkCount,
			totalBytes,
			ttfaMs: firstChunkAt !== null ? firstChunkAt - startedAt : null,
			durationMs: Date.now() - startedAt,
			approxAudioMs: bytesToAudioMs(totalBytes, sampleRate, channels),
			replyLen: assembled.length,
		})
		const total = Date.now() - startedAt
		// pipelined: llmMs = reply-generation span, ttsMs = audio tail; they overlap (sum ≥ wall) — ttfaMs is the headline
		const llmMs = llmDoneAt !== null ? llmDoneAt - startedAt : total
		void reportStageExecution(
			domia,
			logCtx.originDomiaKey,
			logCtx.interactionId,
			[
				{
					stage: "llm",
					executorDomiaKey: domia.domiaKey,
					stageMs: llmMs,
					model: domia.llmModelConfig?.modelName,
					engine: domia.llmModelConfig?.engine,
					promptTokens: usageRef.current?.promptTokens ?? undefined,
					completionTokens: usageRef.current?.completionTokens ?? undefined,
					tokensPerSec: usageRef.current?.tokensPerSec ?? undefined,
					ttftMs: usageRef.current?.ttftMs ?? undefined,
					contextWindow: usageRef.current?.contextWindow ?? undefined,
					finishReason: usageRef.current?.finishReason ?? undefined,
				},
				{
					stage: "tts",
					executorDomiaKey: domia.domiaKey,
					stageMs: Math.max(0, total - llmMs),
					engine: domia.ttsConfig?.engine,
					voice: ttsOptions?.voice?.voiceName ?? domia.ttsConfig?.voiceName,
				},
			],
		)
	}
}

import { ServerError, Status } from "nice-grpc"

import { type DomiaType, getDomiaByDomiaKey } from "@/modules/core"
import type { CoreBusFeaturesType } from "@/modules/core-bus/types"
import { splitSentences } from "@/modules/core-bus/utils/sentence-buffer"
import {
	buildPromptFromPersona,
	personaContextFromDomia,
	personaContextSchema,
	type PersonaContextType,
} from "@/modules/prompt-context-builder"
import { applyMoodDelta, getRecentTrajectory } from "@/modules/emotion-engine"
import { upsertFacts } from "@/modules/memory"
import { updateInteraction } from "@/modules/session-manager"
import { runReflection, flagsForPersona } from "@/modules/reflection"
import {
	admitVoiceReply,
	activeVoiceReplies,
	queuedVoiceReplies,
} from "@/modules/voice-admission"
import { reportReflectionToTarget } from "@/modules/grpc-client"
import { resolveDomiaStreamingCapabilities } from "@/modules/capability-resolver"
import { runLLM } from "@/modules/llm-engine"
import { runSTT } from "@/modules/stt-engine"
import { runTTS } from "@/modules/tts-engine"
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
import {
	DEFAULT_CHANNELS,
	DEFAULT_SAMPLE_RATE,
	HUB_AT_CAPACITY_DETAIL,
} from "./constants"

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
				"invalid persona_context_json — using local persona",
				{ err },
			)
		}
	}
	return personaContextFromDomia(fallback)
}

export const reflectOnPersonaInteraction = async (
	responder: DomiaType,
	persona: PersonaContextType,
	originDomiaKey: string | undefined,
	transcript: string,
	reply: string,
	interactionId?: string,
): Promise<void> => {
	try {
		const flags = flagsForPersona(persona)
		if (!flags.emotion && !flags.facts) return

		const isRemote = !!originDomiaKey && originDomiaKey !== responder.domiaKey
		const trajectory =
			flags.emotion && !isRemote ? await getRecentTrajectory(responder.id) : []

		const { emotion, userEmotion, facts } = await runReflection(
			responder,
			persona,
			transcript,
			reply,
			trajectory,
			flags,
		)
		const hasEmotion = !!emotion && Object.keys(emotion.delta).length > 0
		const hasFacts = facts.length > 0
		const hasUserEmotion = !!userEmotion
		if (!hasEmotion && !hasFacts && !hasUserEmotion) return

		if (!isRemote) {
			if (hasEmotion) applyMoodDelta(responder, emotion.delta, emotion.cause)
			if (hasFacts) await upsertFacts(responder, facts, interactionId)
			if (hasUserEmotion && interactionId)
				await updateInteraction({
					id: interactionId,
					userEmotionSnapshot: userEmotion,
				})
			return
		}

		const origin = await getDomiaByDomiaKey(originDomiaKey)
		if (!origin) return
		await reportReflectionToTarget(
			responder.domiaKey,
			{
				domiaKey: origin.domiaKey,
				domiaId: origin.id,
				localIp: origin.localIp,
				grpcPort: origin.grpcPort,
				source: "explicit",
				streamingCapabilities: resolveDomiaStreamingCapabilities(origin),
			},
			{
				originDomiaKey,
				interactionId,
				emotionDeltaJson: hasEmotion
					? JSON.stringify(emotion.delta)
					: undefined,
				cause: hasEmotion ? emotion.cause : undefined,
				factsJson: hasFacts ? JSON.stringify(facts) : undefined,
				userEmotionJson: hasUserEmotion
					? JSON.stringify(userEmotion)
					: undefined,
			},
		)
	} catch (err) {
		grpcServerLogger.warn("reflectOnPersonaInteraction failed (skipping)", {
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
): AsyncIterable<Buffer> {
	const ttsRunStream = features.tts?.adapter.runStream
	if (canStreamTts(features) && ttsRunStream) {
		yield* ttsRunStream(domia, text)
		return
	}
	const result = await runTTS(domia, text)
	if (!result?.filePath) return
	yield* wavFileToPcmChunks(result.filePath)
}

export const pipelinedReplyChunks = async function* (
	domia: DomiaType,
	promptContext: string,
	features: CoreBusFeaturesType,
	onSentence: (sentence: string) => void,
): AsyncIterable<Buffer> {
	const llmRunStream = features.llm?.adapter.runStream
	if (!llmRunStream) return
	const tokens = llmRunStream(domia, promptContext)
	for await (const sentence of splitSentences(tokens)) {
		onSentence(sentence)
		yield* ttsTextToChunks(domia, sentence, features)
	}
}

export const fullReplyChunks = async function* (
	domia: DomiaType,
	promptContext: string,
	features: CoreBusFeaturesType,
	onReply: (reply: string) => void,
): AsyncIterable<Buffer> {
	const reply = await runLLM(domia, promptContext)
	onReply(reply)
	yield* ttsTextToChunks(domia, reply, features)
}

export const transcribeAudioStream = async (
	domia: DomiaType,
	request: AsyncIterable<AudioChunk>,
	features: CoreBusFeaturesType,
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
					await pcmChunksToWavFile(pcm, captured.meta?.interactionId ?? ""),
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
	const pipelined = canPipelineReply(features)
	const startedAt = Date.now()
	let chunkCount = 0
	let totalBytes = 0
	let firstChunkAt: number | null = null
	let sentenceCount = 0
	let assembled = ""

	grpcServerLogger.info(`📤 ${logCtx.label} ← "${transcript.slice(0, 80)}…"`, {
		interactionId: logCtx.interactionId,
		originDomiaKey: logCtx.originDomiaKey,
		pipelined,
		ttsMode: canStreamTts(features) ? "stream" : "sync",
	})

	try {
		const promptContext = buildPromptFromPersona(persona, transcript)
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

		yield { payload: { $case: "finalReply", finalReply: assembled } }
		void reflectOnPersonaInteraction(
			domia,
			persona,
			logCtx.originDomiaKey,
			transcript,
			assembled,
			logCtx.interactionId,
		)
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
	}
}

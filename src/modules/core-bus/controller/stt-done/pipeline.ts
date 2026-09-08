import {
	publishToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	emitTurnEvent,
	DOMIA_TURN_EVENT_ENUM,
} from "@/buses"
import { domiaBusLogger, toError } from "@/utils"
import {
	ensureReplyOrFallback,
	heardReplyOf,
	notifyAudioFallback,
	notifyInteractionFailed,
	playStreamedAudio,
	createSentencePipeline,
	turnLedgerFor,
	isTurnAborted,
	markLadderStage,
	stampFirstTokenIterable,
	takeLlmUsage,
	usageCols,
	takeReplyQueueWait,
	resourceCols,
	extractEmotionTags,
	splitSentenceEmotionTags,
} from "../../utils"
import { pipelineElapsed } from "@/modules/session-manager"
import { INTERACTION_STATUS_ENUM } from "@/db"
import { reflectOnInteraction } from "@/modules/reflection"
import {
	ttsAdapterToPcmChunks,
	cachedTtsPcmChunks,
	sentenceVoiceForTags,
} from "@/modules/tts-engine"
import type {
	CoreBusContextType,
	SttFlowSessionType,
	PlaybackOutcomeType,
	PipelinePrefixType,
} from "../../types"
import {
	persistTurnComplete,
	finalizeExpressedEmotion,
	publishStreamedReplyComplete,
} from "./persist"

const closeTokenStream = (tokens: AsyncIterable<string>): void => {
	void (tokens as AsyncGenerator<string>).return
		.call(tokens, undefined)
		.catch(() => undefined)
}

export const pipelineVoiceFromTokens = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	tokens: AsyncIterable<string>,
	executors: {
		llmExecutorKey: string | undefined
		llmModelUsed: string | null
	},
	prefix?: PipelinePrefixType,
): Promise<boolean> => {
	try {
		return await pipelineVoiceFromTokensInner(
			ctx,
			session,
			tokens,
			executors,
			prefix,
		)
	} catch (err) {
		closeTokenStream(tokens)
		throw err
	}
}

const pipelineVoiceFromTokensInner = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	tokens: AsyncIterable<string>,
	executors: {
		llmExecutorKey: string | undefined
		llmModelUsed: string | null
	},
	prefix?: PipelinePrefixType,
): Promise<boolean> => {
	const { features, domia } = ctx
	const tts = features.tts
	if (!tts) return false

	const startTime = Date.now()
	const caps = tts.adapter.capabilities
	const pacer = domia.ttsConfig?.pacerEnabled
		? {
				minRemainingMs: domia.ttsConfig.pacerMinRemainingMs,
				maxChars: domia.ttsConfig.pacerMaxChars,
			}
		: null
	const bytesPerMsOut = (caps.sampleRate * caps.channels * 2) / 1000
	let pendingPaced = ""
	const cacheReplyUnits = domia.ttsConfig?.phraseCacheReplyUnitsEnabled === true

	let ttfaMs: number | undefined
	let perceivedTtfaMs: number | undefined
	const firstSentence = { at: undefined as number | undefined }
	const hasFirstSentence = (): boolean => firstSentence.at !== undefined
	let llmFirstSentenceMs: number | undefined
	let ttsFirstChunkMs: number | undefined
	let firstSentenceEmitted = false
	const emitFirstSentence = (): void => {
		if (firstSentenceEmitted) return
		firstSentenceEmitted = true
		emitTurnEvent({
			type: DOMIA_TURN_EVENT_ENUM.LLM_FIRST_SENTENCE,
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey ?? "",
			elapsedMs: llmFirstSentenceMs ?? 0,
		})
	}
	const stampedTokens = stampFirstTokenIterable(session.interactionId, tokens)
	let playbackGone = false as boolean
	const ledger = turnLedgerFor(domia, session.interactionId, {
		sampleRate: caps.sampleRate,
		channels: caps.channels,
	})
	const pipeline = createSentencePipeline(domia, ledger)
	const playbackPromise = playStreamedAudio(
		ctx,
		pipeline.audio,
		{
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			ledger,
			aborted: () => isTurnAborted(domia.id, session.interactionId),
			onFirstChunk: () => {
				ttfaMs =
					pipelineElapsed(session.interactionId) ?? Date.now() - startTime
				if (session.speechEndAt) {
					perceivedTtfaMs = Date.now() - session.speechEndAt
				}
				if (firstSentence.at) ttsFirstChunkMs = Date.now() - firstSentence.at
				emitTurnEvent({
					type: DOMIA_TURN_EVENT_ENUM.TTS_FIRST_AUDIO,
					interactionId: session.interactionId,
					originDomiaKey: session.originDomiaKey ?? "",
					ttsFirstChunkMs,
				})
			},
		},
		{ sampleRate: caps.sampleRate, channels: caps.channels },
	).then(
		(outcome) => {
			if (outcome.interrupted) {
				playbackGone = true
				pipeline.close()
			}
			return outcome
		},
		(err: unknown) => {
			playbackGone = true
			pipeline.close()
			throw err
		},
	)

	let fullReply = ""
	let tokenError: unknown = null
	let playbackError: unknown = null
	let playback: PlaybackOutcomeType = {
		filePath: undefined,
		interrupted: false,
		audioStarted: false,
	}
	try {
		let carriedTags: string[] = []
		if (prefix) {
			firstSentence.at = Date.now()
			llmFirstSentenceMs = 0
			markLadderStage(session.interactionId, "ttsFirstUnitAt", firstSentence.at)
			emitFirstSentence()
			fullReply = prefix.text
			carriedTags = splitSentenceEmotionTags(prefix.text).carryTags
			const prefixText = prefix.text
			const prefixPcm = prefix.pcm
			pipeline.push(
				prefixText,
				(async function* (): AsyncIterable<Buffer> {
					const pcm = await prefixPcm.catch(() => null)
					if (pcm && pcm.length > 0) {
						yield pcm
						return
					}
					yield* ttsAdapterToPcmChunks(domia, tts.adapter, prefixText)
				})(),
			)
		}
		for await (const sentence of pipeline.sentencesOf(
			stampedTokens,
			prefix !== undefined,
		)) {
			if (playbackGone || isTurnAborted(domia.id, session.interactionId)) break
			if (firstSentence.at === undefined) {
				firstSentence.at = Date.now()
				llmFirstSentenceMs = firstSentence.at - startTime
				markLadderStage(
					session.interactionId,
					"ttsFirstUnitAt",
					firstSentence.at,
				)
				emitFirstSentence()
			}
			fullReply += (fullReply.length > 0 ? " " : "") + sentence
			const { applyTags, carryTags } = splitSentenceEmotionTags(sentence)
			const sentenceTags = [...carriedTags, ...applyTags]
			carriedTags = carryTags
			const sentenceVoice = sentenceVoiceForTags(domia, sentenceTags)
			if (sentenceVoice)
				domiaBusLogger.info("🎭 sentence prosody", {
					tags: sentenceTags,
					speed: Number(sentenceVoice.speed.toFixed(3)),
					silenceScale: Number(sentenceVoice.silenceScale.toFixed(3)),
				})
			if (
				pacer &&
				!sentenceVoice &&
				hasFirstSentence() &&
				fullReply !== sentence
			) {
				pendingPaced = pendingPaced ? `${pendingPaced} ${sentence}` : sentence
				const remainingMs =
					ledger.totalBytes() / bytesPerMsOut - (ledger.positionMs() ?? 0)
				if (
					pendingPaced.length < pacer.maxChars &&
					remainingMs > pacer.minRemainingMs
				) {
					continue
				}
				const batch = pendingPaced
				pendingPaced = ""
				await pipeline.waitForSpace()
				pipeline.push(batch, ttsAdapterToPcmChunks(domia, tts.adapter, batch))
				continue
			}
			if (pendingPaced) {
				const batch = pendingPaced
				pendingPaced = ""
				await pipeline.waitForSpace()
				pipeline.push(batch, ttsAdapterToPcmChunks(domia, tts.adapter, batch))
			}
			await pipeline.waitForSpace()
			const unitTts =
				cacheReplyUnits && fullReply === sentence
					? cachedTtsPcmChunks
					: ttsAdapterToPcmChunks
			pipeline.push(
				sentence,
				unitTts(
					domia,
					tts.adapter,
					sentence,
					sentenceVoice ? { voice: sentenceVoice } : undefined,
				),
			)
		}
		if (pendingPaced) {
			pipeline.push(
				pendingPaced,
				ttsAdapterToPcmChunks(domia, tts.adapter, pendingPaced),
				{ primed: false },
			)
			pendingPaced = ""
		}
	} catch (err) {
		tokenError = err
	}
	const aborted = isTurnAborted(domia.id, session.interactionId)
	if (!tokenError && !aborted) {
		const ensured = ensureReplyOrFallback(
			extractEmotionTags(fullReply).clean,
			domia.characterProfile?.language,
		)
		if (ensured.usedFallback) {
			domiaBusLogger.warn("LLM returned empty reply — speaking fallback", {
				domiaId: domia.id,
				interactionId: session.interactionId,
			})
			fullReply = ensured.reply
			pipeline.push(
				fullReply,
				cachedTtsPcmChunks(domia, tts.adapter, fullReply),
				{ primed: false },
			)
		}
	}
	fullReply = finalizeExpressedEmotion(domia, fullReply)
	pipeline.close()
	const llmElapsed = Date.now() - startTime
	try {
		playback = await playbackPromise
	} catch (err) {
		playbackError = err
	}

	const totalElapsed = Date.now() - startTime
	domiaBusLogger.info(`⏱️ LLM+TTS streaming pipeline: ${totalElapsed}ms`)

	if (tokenError) {
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			error: toError(tokenError),
			step: "llm",
			liveVoice: session.liveVoice,
		})
		return true
	}

	if (aborted) {
		await persistTurnComplete({
			id: session.interactionId,
			status: INTERACTION_STATUS_ENUM.ABORTED,
			llmPrompt: session.promptContext,
			llmResponse: fullReply,
			heardReply: heardReplyOf(extractEmotionTags(fullReply).clean, playback),
			ttsEngineUsed: tts.adapter.id,
			ttsExecutorKey: domia.domiaKey,
			ttsAudioPath: playback.filePath,
			totalMs: pipelineElapsed(session.interactionId),
		})
		publishStreamedReplyComplete(domia.id, session, fullReply, playback)
		domiaBusLogger.info(`🛑 turn aborted mid-pipeline — reflection skipped`, {
			domiaId: domia.id,
			interactionId: session.interactionId,
		})
		return true
	}

	const heardReply = heardReplyOf(fullReply, playback)
	void persistTurnComplete({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: fullReply,
		heardReply,
		ttsEngineUsed: tts.adapter.id,
		llmExecutorKey: executors.llmExecutorKey,
		ttsExecutorKey: domia.domiaKey,
		ttsAudioPath: playback.filePath,
		llmMs: llmElapsed,
		ttsMs: Math.max(0, totalElapsed - llmElapsed),
		llmModelUsed: executors.llmModelUsed,
		ttsVoiceUsed: domia.ttsConfig?.voiceName ?? null,
		...usageCols(takeLlmUsage(session.interactionId)),
		...resourceCols(domia),
		llmQueueMs: takeReplyQueueWait(session.interactionId),
		ttfaMs,
		perceivedTtfaMs,
		llmFirstSentenceMs,
		ttsFirstChunkMs,
		totalMs: pipelineElapsed(session.interactionId),
	}).catch((err: unknown) =>
		domiaBusLogger.warn("trace persist (post-pipeline) failed", {
			interactionId: session.interactionId,
			err,
		}),
	)

	if (playbackError) {
		publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
			reply: fullReply,
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			alreadyStreamed: true,
		})
		notifyAudioFallback(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			reason: "tts_failed",
			error: toError(playbackError),
			reply: fullReply,
		})
		return true
	}

	publishStreamedReplyComplete(domia.id, session, fullReply, playback)
	if (heardReply) {
		void reflectOnInteraction(
			domia,
			session.transcript,
			heardReply,
			session.interactionId,
			session.originDomiaKey,
		)
	} else {
		domiaBusLogger.info(
			`🪞 reflection skipped — reply not heard (interrupted/no audio)`,
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
	}
	return true
}

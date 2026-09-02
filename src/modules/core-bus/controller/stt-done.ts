import {
	publishToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	emitTurnEvent,
	DOMIA_TURN_EVENT_ENUM,
} from "@/buses"
import {
	domiaBusLogger,
	getTraceContext,
	isSemaphoreBusyError,
	setTraceContext,
	toError,
	languageSetsFor,
	withIdleTimeout,
} from "@/utils"
import {
	createAsyncQueue,
	concatStreams,
	DEFAULT_SAMPLE_RATE,
	eagerTtsSlotsFromDomia,
	ensureReplyOrFallback,
	heardReplyOf,
	notifyAudioFallback,
	notifyInteractionFailed,
	pipelineDepthFromDomia,
	playStreamedAudio,
	primeStream,
	splitSentences,
	sentenceTuningFromDomia,
	getStreamingSink,
	isTurnAborted,
	notifyTurnAborted,
	recordLlmUsage,
	recordEouMetrics,
	eouCols,
	markLadderStage,
	ladderCols,
	stampFirstTokenIterable,
	createPlaybackLedger,
	registerTurnLedger,
	takeLlmUsage,
	usageCols,
	recordReplyQueueWait,
	takeReplyQueueWait,
	resourceCols,
	pushInteractionTranscript,
	completeInteraction,
	persistTerminal,
	extractEmotionTags,
	splitSentenceEmotionTags,
	speak,
	isRecordingInProgress,
	resolveFastIntent,
	getInteractionRuntime,
	setInteractionTarget,
	stage,
	buildTurnSession,
	skillsEnabled,
	shortlistedToolsOf,
	claimTurnCompleted,
	getActiveTurn,
	recentToolsLine,
	attemptFastPathRoute,
	peekPendingElicit,
	takePendingElicit,
	elicitContentFor,
} from "../utils"
import { applyExpressedEmotionTags } from "@/modules/emotion-engine"
import {
	getOrCreateInteractionId,
	updateInteraction,
	pipelineElapsed,
} from "@/modules/session-manager"
import {
	DEFAULT_TTS_PACER_MIN_REMAINING_MS,
	DEFAULT_TTS_PACER_MAX_CHARS,
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	INTERACTION_STATUS_ENUM,
	RESPONSE_TYPE_ENUM,
	SKILL_TOOL_NAME_SEPARATOR,
	DEFAULT_ASYNC_FOLLOW_UP_POLICY,
	DEFAULT_ASYNC_FOLLOW_UP_MAX_WAIT_MS,
	type SkillToolType,
	type ToolTraceEntryType,
	AGENT_DECISION_MODE_ENUM,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { buildDelegationPersona } from "@/modules/prompt-context-builder"
import { reflectOnInteraction } from "@/modules/reflection"
import { playFeedbackSound } from "@/modules/feedback-sounds"
import { admitVoiceReply } from "@/modules/voice-admission"
import {
	runLLM,
	runLLMWithTools,
	runLLMChatConstrainedJson,
	runLLMReplyStreamOrTools,
	runLLMConstrainedJson,
	type LlmUsageType,
} from "@/modules/llm-engine"
import {
	runAgentTurn,
	peekPendingConfirmation,
	peekExpiredConfirmation,
	takePendingConfirmation,
	settleConfirmation,
	claimConfirmation,
	markConfirmationReasked,
	confirmationScope,
	isAffirmative,
	isNegative,
	createStructuredInference,
	type AgentInferenceType,
	type AgentStreamInferenceType,
	type AgentResultType,
} from "@/modules/agent"
import { deliverReply } from "./llm-done"
import { classifyNeedsSkill } from "@/modules/intent-router"
import {
	buildToolManifest,
	callTool,
	resolveToolFinalize,
	renderFinalizeText,
	claimToolRunSpoken,
	unclaimToolRunSpoken,
} from "@/modules/skill-engine"
import { hasActivePlayback } from "@/modules/audio-playback"
import {
	ttsAdapterToPcmChunks,
	sentenceVoiceForTags,
} from "@/modules/tts-engine"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import {
	streamLlmFromTarget,
	streamReplyAudioFromTarget,
	delegateInferenceWithTools,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type {
	CoreBusContextType,
	SttDonePayloadType,
	SttFlowSessionType,
	PlaybackOutcomeType,
	PipelinePrefixType,
} from "../types"

const LATIN_SCRIPT_LANGUAGES = new Set([
	"en",
	"es",
	"fr",
	"de",
	"pt",
	"it",
	"nl",
])

const scriptMatchesLanguage = (text: string, language: string): boolean => {
	if (!LATIN_SCRIPT_LANGUAGES.has(language)) return true
	const letters = text.match(/\p{L}/gu) ?? []
	if (letters.length === 0) return true
	const latin = text.match(/[a-zA-Z\u00C0-\u024F]/g) ?? []
	return latin.length * 2 >= letters.length
}

const numOrUndef = (v: unknown): number | undefined =>
	typeof v === "number" ? v : undefined

const persistTurnComplete = async (
	payload: Parameters<typeof updateInteraction>[0],
	emitCompletion = true,
): Promise<Awaited<ReturnType<typeof updateInteraction>>> => {
	const p = payload as Record<string, unknown>
	const earlyId = typeof p.id === "string" ? p.id : ""
	// claim BEFORE the await: playback-finished races this write on the streaming path
	const claimed =
		emitCompletion && earlyId ? claimTurnCompleted(earlyId) : false
	const result = await updateInteraction(
		earlyId
			? { ...payload, ...eouCols(earlyId), ...ladderCols(earlyId) }
			: payload,
	)
	if (!emitCompletion) return result
	const ctx = getTraceContext()
	const interactionId = earlyId || (ctx?.interactionId ?? "")
	if (interactionId) {
		if (numOrUndef(p.llmMs) !== undefined) {
			emitTurnEvent({
				type: DOMIA_TURN_EVENT_ENUM.LLM_DONE,
				interactionId,
				originDomiaKey: ctx?.originDomiaKey ?? "",
				traceId: ctx?.traceId,
				llmMs: numOrUndef(p.llmMs),
				llmQueueMs: numOrUndef(p.llmQueueMs),
				promptTokens: numOrUndef(p.llmPromptTokens),
				completionTokens: numOrUndef(p.llmCompletionTokens),
				finishReason:
					typeof p.llmFinishReason === "string" ? p.llmFinishReason : undefined,
			})
		}
		if (claimed) {
			emitTurnEvent({
				type: DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED,
				interactionId,
				originDomiaKey: ctx?.originDomiaKey ?? "",
				traceId: ctx?.traceId,
				status: typeof p.status === "string" ? p.status : "ok",
				ttfaMs: numOrUndef(p.ttfaMs),
				perceivedTtfaMs: numOrUndef(p.perceivedTtfaMs),
				llmQueueMs: numOrUndef(p.llmQueueMs),
				llmFirstSentenceMs: numOrUndef(p.llmFirstSentenceMs),
				ttsFirstChunkMs: numOrUndef(p.ttsFirstChunkMs),
				llmMs: numOrUndef(p.llmMs),
				ttsMs: numOrUndef(p.ttsMs),
				totalMs: numOrUndef(p.totalMs),
			})
		}
	}
	return result
}

const prefixFromPayload = (
	payload: SttDonePayloadType,
): PipelinePrefixType | undefined =>
	payload.prestartedFirstUnitText
		? {
				text: payload.prestartedFirstUnitText,
				pcm: payload.prestartedFirstUnitPcm ?? Promise.resolve(null),
			}
		: undefined

const finalizeExpressedEmotion = (domia: DomiaType, reply: string): string => {
	const expressed = extractEmotionTags(reply)
	if (expressed.tags.length === 0) return reply
	try {
		applyExpressedEmotionTags(domia, expressed.tags)
	} catch (err) {
		domiaBusLogger.warn("expressed emotion apply failed", {
			domiaId: domia.id,
			err,
		})
	}
	return expressed.clean
}

const releasePrestarted = (payload: SttDonePayloadType): void => {
	payload.prestartedRelease?.()
	const tokens = payload.prestartedTokens as AsyncGenerator<string> | undefined
	void tokens?.return?.(undefined).catch(() => undefined)
}

const LLM_STREAM_IDLE_MS = 30000

const QUIET_AUDIO_POLL_MS = 250
const QUIET_AUDIO_DEADLINE_MS = 20000

const waitForQuietAudio = async (domiaId: string): Promise<boolean> => {
	const t0 = Date.now()
	while (hasActivePlayback(domiaId) || isRecordingInProgress(domiaId)) {
		if (Date.now() - t0 > QUIET_AUDIO_DEADLINE_MS) return false
		await new Promise((resolve) => setTimeout(resolve, QUIET_AUDIO_POLL_MS))
	}
	return true
}

const waitForTurnIdle = async (
	domia: DomiaType,
	ownInteractionId: string,
): Promise<boolean> => {
	const policy =
		domia.llmModelConfig?.asyncFollowUpPolicy ?? DEFAULT_ASYNC_FOLLOW_UP_POLICY
	const deadlineMs =
		domia.llmModelConfig?.asyncFollowUpMaxWaitMs ??
		DEFAULT_ASYNC_FOLLOW_UP_MAX_WAIT_MS
	const busy = (): boolean => {
		const live = getActiveTurn(domia.id)
		return live !== null && live.interactionId !== ownInteractionId
	}
	if (!busy()) return true
	if (policy === "drop") return false
	const t0 = Date.now()
	while (busy()) {
		if (Date.now() - t0 > deadlineMs) return false
		await new Promise((resolve) => setTimeout(resolve, QUIET_AUDIO_POLL_MS))
	}
	return true
}

const publishStreamedReplyComplete = (
	domiaId: string,
	session: SttFlowSessionType,
	reply: string,
	playback: PlaybackOutcomeType,
): void => {
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
		reply,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		alreadyStreamed: true,
		liveVoice: session.liveVoice,
	})
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
	})
	publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		status: playback.interrupted ? "interrupted" : "completed",
		playedLocally: playback.audioStarted,
		positionMs: playback.positionMs,
		liveVoice: session.liveVoice,
	})
}

const closeTokenStream = (tokens: AsyncIterable<string>): void => {
	void (tokens as AsyncGenerator<string>).return
		?.call(tokens, undefined)
		.catch(() => undefined)
}

const pipelineVoiceFromTokens = async (
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
	const ttsStreamQueue = createAsyncQueue<AsyncIterable<Buffer>>()
	const caps = tts.adapter.capabilities
	const queueDepth = pipelineDepthFromDomia(domia)
	const pacer = domia.ttsConfig?.pacerEnabled
		? {
				minRemainingMs:
					domia.ttsConfig.pacerMinRemainingMs ??
					DEFAULT_TTS_PACER_MIN_REMAINING_MS,
				maxChars: domia.ttsConfig.pacerMaxChars ?? DEFAULT_TTS_PACER_MAX_CHARS,
			}
		: null
	const bytesPerMsOut = (caps.sampleRate * caps.channels * 2) / 1000
	let pendingPaced = ""
	const eagerSlots = eagerTtsSlotsFromDomia(domia)

	let ttfaMs: number | undefined
	let perceivedTtfaMs: number | undefined
	let firstSentenceAt: number | undefined
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
	let playbackGone = false
	const ledger = createPlaybackLedger(
		{ sampleRate: caps.sampleRate, channels: caps.channels },
		{
			wordLevelHeard: domia.audioPlaybackConfig?.wordLevelHeardEnabled ?? false,
		},
	)
	registerTurnLedger(session.interactionId, ledger)
	const playbackPromise = playStreamedAudio(
		ctx,
		concatStreams(ttsStreamQueue.iter()),
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
				if (firstSentenceAt) ttsFirstChunkMs = Date.now() - firstSentenceAt
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
				ttsStreamQueue.close()
			}
			return outcome
		},
		(err: unknown) => {
			playbackGone = true
			ttsStreamQueue.close()
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
			firstSentenceAt = Date.now()
			llmFirstSentenceMs = 0
			markLadderStage(session.interactionId, "ttsFirstUnitAt", firstSentenceAt)
			emitFirstSentence()
			fullReply = prefix.text
			carriedTags = splitSentenceEmotionTags(prefix.text).carryTags
			const prefixText = prefix.text
			const prefixPcm = prefix.pcm
			ttsStreamQueue.push(
				ledger.wrapSentence(
					extractEmotionTags(prefixText).clean,
					primeStream(
						(async function* (): AsyncIterable<Buffer> {
							const pcm = await prefixPcm.catch(() => null)
							if (pcm && pcm.length > 0) {
								yield pcm
								return
							}
							yield* ttsAdapterToPcmChunks(domia, tts.adapter, prefixText)
						})(),
						eagerSlots,
					),
				),
			)
		}
		for await (const sentence of splitSentences(
			stampedTokens,
			sentenceTuningFromDomia(domia),
			prefix !== undefined,
		)) {
			if (playbackGone || isTurnAborted(domia.id, session.interactionId)) break
			if (firstSentenceAt === undefined) {
				firstSentenceAt = Date.now()
				llmFirstSentenceMs = firstSentenceAt - startTime
				markLadderStage(
					session.interactionId,
					"ttsFirstUnitAt",
					firstSentenceAt,
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
				firstSentenceAt !== undefined &&
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
				await ttsStreamQueue.waitForSpace(queueDepth)
				ttsStreamQueue.push(
					ledger.wrapSentence(
						extractEmotionTags(batch).clean,
						primeStream(
							ttsAdapterToPcmChunks(domia, tts.adapter, batch),
							eagerSlots,
						),
					),
				)
				continue
			}
			if (pendingPaced) {
				const batch = pendingPaced
				pendingPaced = ""
				await ttsStreamQueue.waitForSpace(queueDepth)
				ttsStreamQueue.push(
					ledger.wrapSentence(
						extractEmotionTags(batch).clean,
						primeStream(
							ttsAdapterToPcmChunks(domia, tts.adapter, batch),
							eagerSlots,
						),
					),
				)
			}
			await ttsStreamQueue.waitForSpace(queueDepth)
			ttsStreamQueue.push(
				ledger.wrapSentence(
					extractEmotionTags(sentence).clean,
					primeStream(
						ttsAdapterToPcmChunks(
							domia,
							tts.adapter,
							sentence,
							sentenceVoice ? { voice: sentenceVoice } : undefined,
						),
						eagerSlots,
					),
				),
			)
		}
		if (pendingPaced) {
			ttsStreamQueue.push(
				ledger.wrapSentence(
					extractEmotionTags(pendingPaced).clean,
					ttsAdapterToPcmChunks(domia, tts.adapter, pendingPaced),
				),
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
			ttsStreamQueue.push(
				ledger.wrapSentence(
					extractEmotionTags(fullReply).clean,
					ttsAdapterToPcmChunks(domia, tts.adapter, fullReply),
				),
			)
		}
	}
	fullReply = finalizeExpressedEmotion(domia, fullReply)
	ttsStreamQueue.close()
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
		// pipelined: llmMs = reply-generation span, ttsMs = audio tail; they overlap (sum ≥ wall) — ttfaMs is the headline
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
	}).catch((err) =>
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

const tryLocalFullStreamVoice = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	prestartedTokens?: AsyncIterable<string>,
	prefix?: PipelinePrefixType,
): Promise<boolean> => {
	const { features, domia } = ctx
	const { llm, tts, canSentencePipeline } = features
	const pipelineForSink = getStreamingSink(session.interactionId) !== undefined
	const delivery = getInteractionRuntime(session.interactionId)?.delivery
		.audioDelivery
	if (
		delivery === "none" ||
		!session.isVoice ||
		(!canSentencePipeline && !pipelineForSink) ||
		!llm ||
		!tts
	)
		return false
	if (!llm.adapter.runStream) return false

	return pipelineVoiceFromTokens(
		ctx,
		session,
		prestartedTokens ??
			withIdleTimeout(
				llm.adapter.runStream(
					domia,
					session.promptContext,
					() => isTurnAborted(domia.id, session.interactionId),
					(u) => recordLlmUsage(session.interactionId, u),
				),
				LLM_STREAM_IDLE_MS,
				"llm",
			),
		{
			llmExecutorKey: domia.domiaKey,
			llmModelUsed: domia.llmModelConfig?.modelName ?? null,
		},
		prestartedTokens ? prefix : undefined,
	)
}

const runLocalSyncLlm = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): Promise<void> => {
	const startTime = Date.now()
	const { reply: rawReply } = ensureReplyOrFallback(
		await runLLM(ctx.domia, session.promptContext, (u) =>
			recordLlmUsage(session.interactionId, u),
		),
		ctx.domia.characterProfile?.language,
	)
	const reply = finalizeExpressedEmotion(ctx.domia, rawReply)
	const llmElapsed = Date.now() - startTime
	domiaBusLogger.info(`⏱️ LLM execution time: ${llmElapsed}ms`)

	if (isTurnAborted(ctx.domia.id, session.interactionId)) {
		await notifyTurnAborted(
			ctx.domia.id,
			session.interactionId,
			session.originDomiaKey,
			reply,
		)
		return
	}

	await persistTurnComplete(
		{
			id: session.interactionId,
			llmPrompt: session.promptContext,
			llmResponse: reply,
			llmExecutorKey: ctx.domia.domiaKey,
			llmMs: llmElapsed,
			...usageCols(takeLlmUsage(session.interactionId)),
			...resourceCols(ctx.domia),
			llmQueueMs: takeReplyQueueWait(session.interactionId),
			llmModelUsed: ctx.domia.llmModelConfig?.modelName ?? null,
			totalMs: pipelineElapsed(session.interactionId),
		},
		!session.isVoice,
	)

	void deliverReply(ctx, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
	}).catch((err) => {
		domiaBusLogger.error("runLocalSyncLlm deliverReply failed", {
			domiaId: ctx.domia.id,
			interactionId: session.interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			error: toError(err),
			step: "delivery",
			liveVoice: session.liveVoice,
		})
	})
	if (!session.isVoice) {
		await updateInteraction({ id: session.interactionId, heardReply: reply })
		void reflectOnInteraction(
			ctx.domia,
			session.transcript,
			reply,
			session.interactionId,
			session.originDomiaKey,
		)
	}
}

const withAgentSummary = (result: AgentResultType): ToolTraceEntryType[] => [
	...result.skillResponses,
	{
		kind: "summary",
		decisionMs: result.decisionMs,
		toolMs: result.toolMs,
		finalizeMs: result.finalizeMs,
		finalizeMode: result.finalizeMode,
		stopReason: result.stopReason,
	},
]

const agentTimingCols = (
	result: AgentResultType,
): {
	agentDecisionMs: number | null
	agentToolMs: number | null
	agentFinalizeMs: number | null
} => ({
	agentDecisionMs: result.decisionMs ?? null,
	agentToolMs: result.toolMs ?? null,
	agentFinalizeMs: result.finalizeMs ?? null,
})

const toolCols = (
	result: AgentResultType,
): { toolCallCount: number | null; toolErrorCount: number | null } => {
	const calls = result.toolNamesUsed.length
	if (calls === 0) return { toolCallCount: null, toolErrorCount: null }
	const errors = result.skillResponses.filter(
		(r) =>
			(r.kind === "result" || r.kind === "async_outcome") &&
			r.status !== "ok" &&
			r.status !== "cancelled",
	).length
	return { toolCallCount: calls, toolErrorCount: errors }
}

const tryAgentTurn = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	tools: SkillToolType[],
	inference: AgentInferenceType,
	executor: { key: string; model: string | null },
	streamFinalize?: AgentStreamInferenceType,
	signal?: AbortSignal,
	constrainedRepair?: (
		prompt: string,
		schema: Record<string, unknown>,
	) => Promise<string | null>,
): Promise<boolean> => {
	const { domia } = ctx
	const startTime = Date.now()
	const envelope = getInteractionRuntime(session.interactionId)?.envelope
	const confirmationChannel = envelope?.satelliteId ?? envelope?.source
	const toolsLine = await recentToolsLine(domia).catch(() => null)
	let result: AgentResultType
	try {
		result = await stage(
			{
				interactionId: session.interactionId,
				originDomiaKey: session.originDomiaKey ?? domia.domiaKey,
				satelliteId: envelope?.satelliteId,
				traceId: getTraceContext()?.traceId,
			},
			"skills",
			() =>
				runAgentTurn(domia, session.transcript, tools, inference, {
					voice: session.isVoice,
					streamFinalize,
					allowAsyncTools: session.isVoice && session.liveVoice === true,
					signal,
					confirmationChannel,
					recentToolsLine: toolsLine ?? undefined,
					constrainedRepair,
					onSlowTool:
						session.isVoice && session.liveVoice
							? () => playFeedbackSound(domia, "thinking")
							: undefined,
				}),
		)
	} catch (err) {
		domiaBusLogger.warn("agent turn failed — falling through to normal LLM", {
			domiaId: domia.id,
			interactionId: session.interactionId,
			err,
		})
		return false
	}

	if (result.pendingTools?.length) {
		const pending = result.pendingTools
		const asyncTraceId = getTraceContext()?.traceId
		void Promise.allSettled(pending).then(async (settled) => {
			const outcomes = settled
				.map((s) => (s.status === "fulfilled" ? s.value : null))
				.filter((o): o is NonNullable<typeof o> => o !== null)
			const failures = outcomes.filter((o) => !o.ok)
			const followUp =
				failures.length > 0
					? [...new Set(failures.map((o) => o.doneText))].join(" ")
					: [...new Set(outcomes.map((o) => o.doneText))].join(" ")
			domiaBusLogger.info(
				`🧰 async tools settled (${outcomes.length}) → "${followUp}"`,
				{ domiaId: domia.id, interactionId: session.interactionId },
			)
			const outcomeEntries: ToolTraceEntryType[] = outcomes.map((o) => ({
				kind: "async_outcome",
				tool: o.tool,
				status: o.ok ? "ok" : "failed",
				summaryForLlm: o.doneText,
				resolvedArgs: o.resolvedArgs,
			}))
			for (const o of outcomes) {
				emitTurnEvent({
					type: DOMIA_TURN_EVENT_ENUM.TOOL_RESULT,
					interactionId: session.interactionId,
					originDomiaKey: session.originDomiaKey ?? "",
					traceId: asyncTraceId,
					toolName: o.tool,
					status: o.ok ? "ok" : "failed",
				})
			}
			const settledResult = {
				...result,
				skillResponses: [...result.skillResponses, ...outcomeEntries],
			}
			void updateInteraction({
				id: session.interactionId,
				skillResponse: withAgentSummary(settledResult),
				toolErrorCount:
					failures.length > 0
						? failures.length
						: (toolCols(result).toolErrorCount ?? null),
			}).catch((err) =>
				domiaBusLogger.warn("async-tool outcome persist failed", {
					interactionId: session.interactionId,
					err,
				}),
			)
			if (!followUp) return
			if (isTurnAborted(domia.id, session.interactionId)) {
				domiaBusLogger.info("async tool follow-up dropped — turn superseded", {
					domiaId: domia.id,
					interactionId: session.interactionId,
				})
				return
			}
			const quiet = await waitForQuietAudio(domia.id)
			if (!quiet) {
				domiaBusLogger.warn(
					"async tool follow-up dropped — audio busy past deadline",
					{ domiaId: domia.id, interactionId: session.interactionId },
				)
				return
			}
			const idle = await waitForTurnIdle(domia, session.interactionId)
			if (!idle) {
				domiaBusLogger.info(
					"async tool follow-up dropped — a newer turn is live",
					{ domiaId: domia.id, interactionId: session.interactionId },
				)
				return
			}
			if (isTurnAborted(domia.id, session.interactionId)) {
				domiaBusLogger.info("async tool follow-up dropped — turn superseded", {
					domiaId: domia.id,
					interactionId: session.interactionId,
				})
				return
			}
			const speakable = outcomes.filter((o) =>
				claimToolRunSpoken(session.interactionId, o.tool, o.resolvedArgs),
			)
			if (speakable.length === 0) {
				domiaBusLogger.info("async tool follow-up already spoken — skipped", {
					domiaId: domia.id,
					interactionId: session.interactionId,
				})
				return
			}
			const speakableFailures = speakable.filter((o) => !o.ok)
			const spokenText = [
				...new Set(
					(speakableFailures.length > 0 ? speakableFailures : speakable).map(
						(o) => o.doneText,
					),
				),
			].join(" ")
			void speak(domia, spokenText).catch((err) => {
				domiaBusLogger.warn("async tool follow-up speak failed — unclaiming", {
					domiaId: domia.id,
					err,
				})
				for (const o of speakable)
					unclaimToolRunSpoken(session.interactionId, o.tool, o.resolvedArgs)
			})
		})
	}

	if (result.replyStream && session.isVoice) {
		try {
			await updateInteraction({
				id: session.interactionId,
				skillProviderUsed: result.serversUsed.join(",") || null,
				skillPrompt: result.skillPrompt,
				skillResponse: withAgentSummary(result),
				...agentTimingCols(result),
				...toolCols(result),
			})
			const piped = await pipelineVoiceFromTokens(
				ctx,
				session,
				result.replyStream,
				{
					llmExecutorKey: executor.key,
					llmModelUsed: executor.model,
				},
			)
			if (!piped) result.replyStreamClose?.()
			return piped
		} catch (err) {
			result.replyStreamClose?.()
			throw err
		}
	}

	if (result.replyStream) result.replyStreamClose?.()

	const { reply: agentReply } = ensureReplyOrFallback(
		result.reply,
		domia.characterProfile?.language,
	)
	const reply = finalizeExpressedEmotion(domia, agentReply)
	const llmElapsed = Date.now() - startTime

	await persistTurnComplete(
		{
			id: session.interactionId,
			llmPrompt: session.promptContext,
			llmResponse: reply,
			llmExecutorKey: executor.key,
			llmMs: result.finalizeMs ?? llmElapsed,
			llmModelUsed: executor.model,
			skillProviderUsed: result.serversUsed.join(",") || null,
			skillPrompt: result.skillPrompt,
			skillResponse: withAgentSummary(result),
			...agentTimingCols(result),
			...toolCols(result),
			...usageCols(takeLlmUsage(session.interactionId)),
			...resourceCols(domia),
			llmQueueMs: takeReplyQueueWait(session.interactionId),
			totalMs: pipelineElapsed(session.interactionId),
		},
		!session.isVoice,
	)

	void deliverReply(ctx, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
	}).catch((err) => {
		domiaBusLogger.error("agent turn deliverReply failed", {
			domiaId: domia.id,
			interactionId: session.interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			error: toError(err),
			step: "delivery",
			liveVoice: session.liveVoice,
		})
	})

	if (!session.isVoice) {
		await updateInteraction({ id: session.interactionId, heardReply: reply })
		void reflectOnInteraction(
			domia,
			session.transcript,
			reply,
			session.interactionId,
			session.originDomiaKey,
		)
	}
	return true
}

const attemptLocalSkillsRoute = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	payload: SttDonePayloadType,
	turnSignal: AbortSignal | undefined,
): Promise<boolean> => {
	const { domia, features } = ctx
	if (!skillsEnabled(ctx)) return false
	if (payload.prestartedTokens) {
		const stale = payload.prestartedTokens as AsyncGenerator<string>
		domiaBusLogger.info(
			"🔮 skills route with prestarted stream — cancelling stale speculation",
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
		void stale.return?.(undefined).catch(() => undefined)
		payload.prestartedTokens = undefined
		payload.prestartedFirstUnitText = undefined
		payload.prestartedFirstUnitPcm = undefined
	}
	const tools = await shortlistedToolsOf(domia, session.transcript)
	if (tools.length === 0 || !features.llm?.adapter.runWithTools) return false
	const intentStart = Date.now()
	const hints =
		domia.llmModelConfig?.descriptorRoutingEnabled === true
			? (() => {
					const manifest = buildToolManifest(domia)
					return {
						exampleUtterances: manifest.exampleUtterances,
						keywords: manifest.keywords,
					}
				})()
			: undefined
	const decision = await classifyNeedsSkill(
		domia,
		session.transcript,
		tools.map((t) => ({
			name: t.rawName,
			description: t.description,
		})),
		{ canRunLlm: true, hints },
	)
	const intentDecision = `${decision.needsSkill ? "skill" : "chat"} (${decision.reason})`
	const intentMs = Date.now() - intentStart
	domiaBusLogger.info(`🧭 intent: ${intentDecision} ${intentMs}ms`, {
		domiaId: domia.id,
	})
	void updateInteraction({
		id: session.interactionId,
		intentDecision,
		intentMs,
	})
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.INTENT_DECIDED,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey ?? "",
		traceId: getTraceContext()?.traceId,
		decision: intentDecision,
		intentMs,
	})
	if (!decision.needsSkill) return false
	const onUsage = (u: LlmUsageType) => recordLlmUsage(session.interactionId, u)
	const structuredMode =
		domia.llmModelConfig?.agentDecisionMode ===
		AGENT_DECISION_MODE_ENUM.STRUCTURED
	const inference: AgentInferenceType = structuredMode
		? createStructuredInference(domia, (messages, schema, signal) =>
				runLLMChatConstrainedJson(domia, messages, schema, onUsage, signal),
			)
		: (messages, toolDefs, toolChoice, signal) =>
				runLLMWithTools(domia, messages, toolDefs, onUsage, toolChoice, signal)
	const streamFinalize: AgentStreamInferenceType | undefined =
		features.canSentencePipeline && !structuredMode
			? (messages, toolDefs, toolChoice, signal) =>
					runLLMReplyStreamOrTools(
						domia,
						messages,
						toolDefs,
						onUsage,
						toolChoice,
						signal,
					)
			: undefined
	return tryAgentTurn(
		ctx,
		session,
		tools,
		inference,
		{
			key: domia.domiaKey,
			model: domia.llmModelConfig?.modelName ?? null,
		},
		streamFinalize,
		turnSignal,
		(prompt, schema) => runLLMConstrainedJson(domia, prompt, schema),
	)
}

const attemptDelegatedSkillsRoute = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
	turnSignal: AbortSignal | undefined,
): Promise<boolean> => {
	const { domia } = ctx
	if (!skillsEnabled(ctx)) return false
	const tools = await shortlistedToolsOf(domia, session.transcript)
	if (tools.length === 0) return false
	const target = targets[0]
	domiaBusLogger.info("🛰️ delegating agent inference to peer", {
		target: target.domiaKey,
		tools: tools.length,
	})
	const inference: AgentInferenceType = (messages, toolDefs) =>
		delegateInferenceWithTools(domia.domiaKey, target, {
			messages,
			tools: toolDefs,
			originDomiaKey: session.originDomiaKey ?? domia.domiaKey,
			interactionId: session.interactionId,
		})
	return tryAgentTurn(
		ctx,
		session,
		tools,
		inference,
		{
			key: target.domiaKey,
			model: null,
		},
		undefined,
		turnSignal,
	)
}

const tryDelegatedReplyAudio = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
): Promise<boolean> => {
	if (!session.isVoice || !ctx.features.canPlayback) return false
	const replyTargets = targets.filter(
		(target) =>
			target.streamingCapabilities.llm && target.streamingCapabilities.tts,
	)
	if (replyTargets.length === 0) return false

	const { domia } = ctx
	const startTime = Date.now()
	domiaBusLogger.info(
		`📡 streaming replyAudio delegation (${replyTargets.length} targets)`,
		{ domiaId: domia.id, interactionId: session.interactionId },
	)

	const streamed = await streamReplyAudioFromTarget(
		domia.domiaKey,
		replyTargets,
		{
			transcript: session.transcript,
			originDomiaKey: session.originDomiaKey,
			interactionId: session.interactionId,
			responseType: session.responseType,
			persona: buildDelegationPersona(domia, session),
		},
	)

	if (streamed.atCapacity) {
		domiaBusLogger.warn(
			`replyAudio delegation: hub at capacity — surfacing graceful busy (no fallback)`,
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			error: "hub at capacity",
			step: "capacity",
			liveVoice: session.liveVoice,
		})
		return true
	}

	if (!streamed.delivered || !streamed.audio) {
		domiaBusLogger.warn(
			`replyAudio delegation failed (${streamed.error ?? "unknown"}) — falling back to streamLlm`,
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
		return false
	}

	const audioIter = streamed.audio[Symbol.asyncIterator]()
	let audioEmitted = false
	const trackedAudio = (async function* (): AsyncIterable<Buffer> {
		try {
			while (true) {
				const next = await audioIter.next()
				if (next.done) break
				audioEmitted = true
				yield next.value
			}
		} finally {
			await audioIter.return?.().catch(() => undefined)
		}
	})()

	try {
		const channels = (streamed.channels === 2 ? 2 : 1) as 1 | 2
		let ttfaMs: number | undefined
		let perceivedTtfaMs: number | undefined
		const playback = await playStreamedAudio(
			ctx,
			trackedAudio,
			{
				interactionId: session.interactionId,
				originDomiaKey: session.originDomiaKey,
				onFirstChunk: () => {
					ttfaMs = pipelineElapsed(session.interactionId) ?? undefined
					if (session.speechEndAt) {
						perceivedTtfaMs = Date.now() - session.speechEndAt
					}
				},
			},
			{
				sampleRate: streamed.sampleRate ?? DEFAULT_SAMPLE_RATE,
				channels,
			},
		)
		const reply = finalizeExpressedEmotion(
			domia,
			(await streamed.finalReplyPromise) ?? "",
		)
		domiaBusLogger.info(
			`⏱️ replyAudio delegation pipeline: ${Date.now() - startTime}ms`,
		)
		const heardReply = heardReplyOf(reply, playback)
		await persistTurnComplete({
			id: session.interactionId,
			llmPrompt: session.promptContext,
			llmResponse: reply,
			heardReply,
			llmExecutorKey: streamed.target?.domiaKey,
			ttsExecutorKey: streamed.target?.domiaKey,
			ttsAudioPath: playback.filePath,
			ttfaMs,
			perceivedTtfaMs,
			totalMs: pipelineElapsed(session.interactionId),
		})
		publishStreamedReplyComplete(domia.id, session, reply, playback)
		if (heardReply) {
			void reflectOnInteraction(
				domia,
				session.transcript,
				heardReply,
				session.interactionId,
				session.originDomiaKey,
			)
		}
		return true
	} catch (err) {
		await audioIter.return?.().catch(() => undefined)
		if (!audioEmitted) {
			domiaBusLogger.warn(
				`replyAudio delegation playback failed (${(err as Error)?.message ?? "unknown"}) — falling back`,
				{ domiaId: domia.id, interactionId: session.interactionId },
			)
			return false
		}
		domiaBusLogger.warn(
			`replyAudio delegation playback failed after audio started — NOT falling back (would double-reply)`,
			{ domiaId: domia.id, interactionId: session.interactionId, err },
		)
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			error: err as Error,
			step: "playback",
			silent: true,
			liveVoice: session.liveVoice,
		})
		return true
	}
}

const runDelegatedStreamLlm = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
): Promise<void> => {
	const orderedTargets = [...targets].sort(
		(a, b) =>
			Number(b.streamingCapabilities.llm) - Number(a.streamingCapabilities.llm),
	)

	const { domia } = ctx
	domiaBusLogger.info(
		`📡 streaming LLM delegation (${orderedTargets.length} targets)`,
		{ domiaId: domia.id, interactionId: session.interactionId },
	)
	const streamed = await streamLlmFromTarget(domia.domiaKey, orderedTargets, {
		transcript: session.transcript,
		originDomiaKey: session.originDomiaKey,
		interactionId: session.interactionId,
		responseType: session.responseType,
		persona: buildDelegationPersona(domia, session),
	})

	if (!streamed.delivered || !streamed.tokens) {
		throw new Error(
			`STT_DONE delegation failed: ${streamed.error ?? "unknown"} (tried ${streamed.attemptedTargets})`,
		)
	}

	if (session.isVoice && ctx.features.canRunTts && ctx.features.canPlayback) {
		const piped = await pipelineVoiceFromTokens(ctx, session, streamed.tokens, {
			llmExecutorKey: streamed.target?.domiaKey,
			llmModelUsed: null,
		})
		if (piped) return
	}

	let collected = ""
	for await (const token of streamed.tokens) collected += token
	const { reply } = ensureReplyOrFallback(
		collected,
		ctx.domia.characterProfile?.language,
	)
	await updateInteraction({
		id: session.interactionId,
		llmPrompt: session.promptContext,
		llmResponse: reply,
		llmExecutorKey: streamed.target?.domiaKey,
	})
	void deliverReply(ctx, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
	}).catch((err) => {
		domiaBusLogger.error("runDelegatedStreamLlm deliverReply failed", {
			domiaId: domia.id,
			interactionId: session.interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			error: toError(err),
			step: "delivery",
			liveVoice: session.liveVoice,
		})
	})
}

export const handleSttDone = async (
	ctx: CoreBusContextType,
	payload: SttDonePayloadType,
): Promise<void> => {
	const { domia } = ctx
	const domiaId = domia.id
	const { transcript, originDomiaKey } = payload

	domiaBusLogger.info(`📝 STT_DONE: ${transcript}`, { domiaId })

	if (payload.interactionId && transcript.trim()) {
		pushInteractionTranscript(payload.interactionId, transcript)
		markLadderStage(payload.interactionId, "sttFinalAt")
		if (payload.speechEndAt) {
			markLadderStage(payload.interactionId, "speechEndAt", payload.speechEndAt)
			recordEouMetrics(payload.interactionId, {
				transcriptionDelayMs: Date.now() - payload.speechEndAt,
				eouDelayMs: payload.endpointDelayMs ?? null,
				endpointDebounceMs: payload.endpointDebounceMs ?? null,
			})
		}
		if (payload.endpointDecisionAt) {
			markLadderStage(
				payload.interactionId,
				"endpointDecisionAt",
				payload.endpointDecisionAt,
			)
		}
		emitTurnEvent({
			type: DOMIA_TURN_EVENT_ENUM.STT_FINAL,
			interactionId: payload.interactionId,
			originDomiaKey: originDomiaKey ?? "",
			traceId: payload.traceId,
			transcript,
			speculative: Boolean(payload.prestartedTokens),
		})
	}

	if (payload.alreadyHandled) {
		domiaBusLogger.info(
			`📝 STT_DONE: alreadyHandled — fused voice reply already ran, skipping`,
			{ domiaId, interactionId: payload.interactionId },
		)
		releasePrestarted(payload)
		return
	}

	if (payload.interactionId && isTurnAborted(domiaId, payload.interactionId)) {
		releasePrestarted(payload)
		await notifyTurnAborted(domiaId, payload.interactionId, originDomiaKey)
		return
	}

	try {
		await handleSttDoneFlow(ctx, payload)
	} finally {
		payload.prestartedRelease?.()
	}
}

const handleSttDoneFlow = async (
	ctx: CoreBusContextType,
	payload: SttDonePayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const domiaId = domia.id
	const { transcript: rawTranscript, originDomiaKey, responseType } = payload
	// wrong-script transcript for the configured language = decoder noise ("係。") — treat as silence
	const transcript = scriptMatchesLanguage(
		rawTranscript,
		domia.sttConfig?.language ?? "en",
	)
		? rawTranscript
		: ""

	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
			inputRaw: transcript,
			sttResult: transcript,
			responseType:
				responseType === RESPONSE_TYPE_ENUM.VOICE
					? RESPONSE_TYPE_ENUM.VOICE
					: RESPONSE_TYPE_ENUM.TEXT,
		},
	)
	if (!interactionId) return
	setTraceContext({ interactionId, originDomiaKey })

	void updateInteraction({
		id: interactionId,
		inputRaw: transcript,
		sttResult: transcript,
	}).catch((err) =>
		domiaBusLogger.error("STT_DONE: snapshot persistence failed", {
			domiaId,
			interactionId,
			err,
		}),
	)

	const wakeWordOnly = (() => {
		const wake = domia.wakeWordConfig?.wakeWord?.trim().toLowerCase()
		if (!wake) return false
		const spoken = transcript
			.trim()
			.toLowerCase()
			.replace(/[.,!?¡¿]/g, "")
		if (!spoken || spoken.includes(" ")) return false
		if (spoken === wake) return true
		return spoken.length >= 4 && wake.startsWith(spoken)
	})()
	if (!transcript.trim() || wakeWordOnly) {
		domiaBusLogger.info(
			wakeWordOnly
				? `📝 STT_DONE: wake-word-only transcript ("${transcript.trim()}") — discarding turn`
				: `📝 STT_DONE: empty transcript — no speech detected, ending turn without LLM/TTS`,
			{ domiaId, interactionId },
		)
		void persistTerminal(interactionId, INTERACTION_STATUS_ENUM.NO_SPEECH)
		if (payload.liveVoice) playFeedbackSound(domia, "error")
		completeInteraction(interactionId, {
			result: { transcript: "", reply: "" },
		})
		return
	}

	if (originDomiaKey) {
		const envelope = getInteractionRuntime(interactionId)?.envelope
		const confirmScope = confirmationScope(
			domia.domiaKey,
			envelope?.satelliteId ?? envelope?.source,
		)
		const elicitEntry = peekPendingElicit(confirmScope)
			? takePendingElicit(confirmScope)
			: null
		if (elicitEntry) {
			const elicitAffirmative = isAffirmative(transcript, elicitEntry.language)
			const elicitNegative = isNegative(transcript, elicitEntry.language)
			const elicitContent =
				elicitNegative && !elicitAffirmative
					? null
					: elicitContentFor(
							elicitEntry.requestedSchema,
							transcript,
							elicitAffirmative,
							elicitNegative,
						)
			if (elicitContent === null) elicitEntry.resolve({ action: "decline" })
			else elicitEntry.resolve({ action: "accept", content: elicitContent })
			domiaBusLogger.info(
				`🛎️ elicitation answered: "${transcript.slice(0, 60)}"`,
				{ domiaId, interactionId },
			)
			void updateInteraction({
				id: interactionId,
				intentDecision: "elicit-answer",
			}).catch(() => undefined)
			return
		}
		const pending = peekPendingConfirmation(confirmScope)
		if (!pending) {
			const expired = peekExpiredConfirmation(confirmScope)
			if (expired && isAffirmative(transcript, expired.language)) {
				settleConfirmation(confirmScope, "expired")
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
					reply:
						languageSetsFor(expired.language).phrases.confirmExpired ??
						"That confirmation expired — tell me again if you still want it.",
					transcript,
					interactionId,
					originDomiaKey,
					responseType: payload.responseType,
					speechEndAt: payload.speechEndAt,
					liveVoice: payload.liveVoice,
				})
				return
			}
		}
		if (pending) {
			const phrases = languageSetsFor(pending.language).phrases
			const replyConfirm = (reply: string): void =>
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
					reply,
					transcript,
					interactionId,
					originDomiaKey,
					responseType: payload.responseType,
					speechEndAt: payload.speechEndAt,
					liveVoice: payload.liveVoice,
				})
			const affirmative = isAffirmative(transcript, pending.language)
			const negative = isNegative(transcript, pending.language)
			const taken =
				affirmative !== negative ? takePendingConfirmation(confirmScope) : null
			const claimed = taken
				? claimConfirmation(confirmScope, affirmative ? "approved" : "denied")
				: false
			if (taken && !claimed) {
				domiaBusLogger.warn(
					"confirmation claim lost — not executing (already settled or persist failed)",
					{ domiaId, interactionId, tool: taken.tool },
				)
				replyConfirm(
					phrases.confirmExpired ??
						"That confirmation expired — tell me again if you still want it.",
				)
				return
			}
			if (taken && affirmative) {
				emitTurnEvent({
					type: DOMIA_TURN_EVENT_ENUM.TOOL_REQUESTED,
					interactionId,
					originDomiaKey,
					traceId: getTraceContext()?.traceId,
					toolName: taken.tool,
				})
				let reply: string
				let trace: Extract<ToolTraceEntryType, { kind: "result" }>
				const toolStart = Date.now()
				try {
					const res = taken.resolvedArgs
						? await callTool(
								domia.id,
								taken.tool,
								taken.resolvedArgs,
								undefined,
								true,
							)
						: await callTool(domia.id, taken.tool, taken.args)
					const ok = res.status === "ok" && !res.isError
					const rule = resolveToolFinalize(domia.id, taken.tool)
					const template = ok ? rule?.done : rule?.error
					const fallback = ok ? phrases.thatIsDone : phrases.cantDoThat
					reply = template
						? (renderFinalizeText(template, taken.args, res.resolvedArgs) ??
							fallback)
						: fallback
					trace = {
						kind: "result",
						tool: taken.tool,
						status: ok ? "ok" : "failed",
						durationMs: Date.now() - toolStart,
						summaryForLlm: res.text,
						args: taken.args,
						resolvedArgs: res.resolvedArgs,
					}
				} catch (err) {
					domiaBusLogger.warn("confirmed action failed", {
						domiaId,
						interactionId,
						err,
					})
					reply = phrases.cantDoThat ?? "I couldn't do that."
					trace = {
						kind: "result",
						tool: taken.tool,
						status: "failed",
						durationMs: Date.now() - toolStart,
						summaryForLlm: String(err),
						args: taken.args,
					}
				}
				emitTurnEvent({
					type: DOMIA_TURN_EVENT_ENUM.TOOL_RESULT,
					interactionId,
					originDomiaKey,
					traceId: getTraceContext()?.traceId,
					toolName: taken.tool,
					status: trace.status,
					toolMs: Date.now() - toolStart,
				})
				void updateInteraction({
					id: interactionId,
					skillProviderUsed:
						taken.tool.split(SKILL_TOOL_NAME_SEPARATOR)[0] ?? null,
					skillResponse: [trace],
					toolCallCount: 1,
				})
				replyConfirm(reply)
				return
			}
			if (taken && negative) {
				const deniedTrace: ToolTraceEntryType = {
					kind: "result",
					tool: taken.tool,
					status: "denied",
					durationMs: 0,
					summaryForLlm: "not run — user declined",
					args: taken.args,
					resolvedArgs: taken.resolvedArgs,
				}
				void updateInteraction({
					id: interactionId,
					skillProviderUsed:
						taken.tool.split(SKILL_TOOL_NAME_SEPARATOR)[0] ?? null,
					skillResponse: [deniedTrace],
				})
				replyConfirm(phrases.cancelledAction ?? "Okay, I won't do that.")
				return
			}
			const offTopicWords = transcript
				.trim()
				.split(/\s+/)
				.filter(Boolean).length
			if (
				!taken &&
				affirmative === negative &&
				offTopicWords <= 4 &&
				!pending.reasked
			) {
				markConfirmationReasked(confirmScope)
				replyConfirm(
					phrases.confirmReask ??
						phrases.confirmAction ??
						"Please answer yes or no.",
				)
				return
			}
			if (affirmative === negative) settleConfirmation(confirmScope, "ignored")
		}
	}

	if (originDomiaKey) {
		const runtime = getInteractionRuntime(interactionId)
		const fast = resolveFastIntent(transcript, {
			domia,
			interactionId,
			originDomiaKey,
			satelliteId: runtime?.envelope.satelliteId,
			transcript,
		})
		if (fast) {
			domiaBusLogger.info(`⚡ fast-intent ${fast.name} → "${fast.confirm}"`, {
				domiaId,
				interactionId,
			})
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
				reply: fast.confirm,
				transcript,
				interactionId,
				originDomiaKey,
				responseType: payload.responseType,
				speechEndAt: payload.speechEndAt,
				liveVoice: payload.liveVoice,
			})
			return
		}
	}

	if (originDomiaKey) {
		const routed = await attemptFastPathRoute(
			ctx,
			payload,
			interactionId,
			transcript,
			originDomiaKey,
		).catch((err) => {
			domiaBusLogger.warn("fast-path route failed — falling through", {
				domiaId,
				interactionId,
				err,
			})
			return false
		})
		if (routed) {
			releasePrestarted(payload)
			return
		}
	}

	const stageEnv = {
		interactionId,
		originDomiaKey: originDomiaKey ?? domia.domiaKey,
		satelliteId: getInteractionRuntime(interactionId)?.envelope.satelliteId,
		traceId: getTraceContext()?.traceId,
	}

	const { session, scope, turnSignal } = await stage(stageEnv, "context", () =>
		buildTurnSession(domia, payload, interactionId, transcript, domiaId),
	)

	try {
		if (features.canRunLlm) {
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PROCESSING_STARTED, {
				interactionId,
				originDomiaKey,
				liveVoice: payload.liveVoice,
			})
			if (payload.liveVoice) playFeedbackSound(domia, "thinking")
			const admitStart = Date.now()
			const release =
				payload.prestartedRelease ??
				(await admitVoiceReply(domia).catch((err: unknown) => {
					if (isSemaphoreBusyError(err)) return null
					throw err
				}))
			markLadderStage(interactionId, "llmQueuedAt", admitStart)
			if (!payload.prestartedRelease) {
				recordReplyQueueWait(interactionId, Date.now() - admitStart)
			}
			if (!release) {
				notifyInteractionFailed(ctx, {
					interactionId,
					originDomiaKey,
					responseType,
					error: "at capacity — too many concurrent turns",
					step: "capacity",
					liveVoice: session.liveVoice,
				})
				return
			}
			try {
				if (await attemptLocalSkillsRoute(ctx, session, payload, turnSignal))
					return
				if (
					await tryLocalFullStreamVoice(
						ctx,
						session,
						payload.prestartedTokens,
						prefixFromPayload(payload),
					)
				)
					return
				if (payload.prestartedTokens) {
					domiaBusLogger.info(
						"🔮 prestarted stream unconsumable — cancelling before sync LLM",
						{ domiaId: domia.id, interactionId: session.interactionId },
					)
					const stale = payload.prestartedTokens as AsyncGenerator<string>
					void stale.return?.(undefined).catch(() => undefined)
					payload.prestartedTokens = undefined
					payload.prestartedFirstUnitText = undefined
					payload.prestartedFirstUnitPcm = undefined
				}
				await runLocalSyncLlm(ctx, session)
				return
			} finally {
				release()
			}
		}

		if (payload.prestartedTokens) {
			if (
				session.isVoice &&
				features.canRunTts &&
				features.canPlayback &&
				(await pipelineVoiceFromTokens(
					ctx,
					session,
					payload.prestartedTokens,
					{
						llmExecutorKey: payload.prestartedExecutorKey,
						llmModelUsed: null,
					},
					prefixFromPayload(payload),
				))
			) {
				return
			}
			let collected = ""
			for await (const token of payload.prestartedTokens) collected += token
			const { reply: collectedReply } = ensureReplyOrFallback(collected)
			const reply = finalizeExpressedEmotion(domia, collectedReply)
			await updateInteraction({
				id: interactionId,
				llmPrompt: session.promptContext,
				llmResponse: reply,
				llmExecutorKey: payload.prestartedExecutorKey,
			})
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
				reply,
				transcript: session.transcript,
				interactionId,
				originDomiaKey,
				responseType,
				speechEndAt: payload.speechEndAt,
				liveVoice: payload.liveVoice,
			})
			return
		}

		const targets = await resolveCapabilityDelegations(
			domia,
			CAPABILITY_ENUM.LLM,
		)
		if (targets.length === 0) {
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
				capability: CAPABILITY_ENUM.LLM,
				interactionId,
				originDomiaKey,
				responseType,
			})
			return
		}

		setInteractionTarget(interactionId, targets[0].domiaKey)

		if (await attemptDelegatedSkillsRoute(ctx, session, targets, turnSignal))
			return

		if (await tryDelegatedReplyAudio(ctx, session, targets)) return
		await runDelegatedStreamLlm(ctx, session, targets)
	} catch (err) {
		domiaBusLogger.error("STT_DONE: LLM or delegate failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType,
			error: toError(err),
			step: "llm",
			liveVoice: session.liveVoice,
		})
	} finally {
		scope?.end()
	}
}

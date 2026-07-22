import {
	publishToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	emitTurnEvent,
	DOMIA_TURN_EVENT_ENUM,
} from "@/buses"
import { domiaBusLogger } from "@/utils"
import {
	CAPABILITY_ENUM,
	RESPONSE_TYPE_ENUM,
	AUDIO_PLAYBACK_ENGINE_ENUM,
	DEFAULT_STT_DECODE_PADDING_MS,
} from "@/db"
import { prewarmSoxPlayer } from "@/modules/audio-playback"
import {
	startSpeculativeCapture,
	endpointHintMs,
	type SpeculativeCaptureHooksType,
} from "@/modules/audio-capture"
import { markPipelineStart, updateInteraction } from "@/modules/session-manager"
import {
	buildPromptContext,
	buildDelegationPersona,
} from "@/modules/prompt-context-builder"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import {
	streamLlmFromTarget,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type { SttStreamSessionType } from "@/modules/stt-engine"
import { ttsAdapterToPcmChunks, ttsPoolBusy } from "@/modules/tts-engine"
import {
	takeMemoryBundle,
	prefetchMemoryBundle,
	createAsyncQueue,
	countSpeculationHandoff,
	countSpeculationWasted,
	countSpeculationDiscarded,
	sentenceTuningFromDomia,
	cutFirstUnit,
	isSpeakable,
	skillsMayIntercept,
	looksSkillish,
} from "../utils"
import type {
	CoreBusContextType,
	SpeculationType,
	SpeculativeTurnArgsType,
} from "../types"

const SPECULATION_MAX_ATTEMPTS = 3
const SPECULATION_MAX_UTTERANCE_MS = 10000

const collectPcm = async (
	ctx: CoreBusContextType,
	text: string,
): Promise<Buffer | null> => {
	const tts = ctx.features.tts
	if (!tts) return null
	const parts: Buffer[] = []
	for await (const chunk of ttsAdapterToPcmChunks(
		ctx.domia,
		tts.adapter,
		text,
	)) {
		parts.push(chunk)
	}
	return parts.length > 0 ? Buffer.concat(parts) : null
}

const wireFirstUnitDivert = (
	ctx: CoreBusContextType,
	me: SpeculationType,
	interactionId: string,
): void => {
	const { domia } = ctx
	const out = me.outQueue
	if (!out) return
	const tuning = sentenceTuningFromDomia(domia)
	void (async () => {
		let buffer = ""
		let flushed = false
		try {
			for await (const token of me.queue.iter()) {
				if (out.isClosed()) {
					me.cancelled = true
					break
				}
				if (flushed) {
					out.push(token)
					continue
				}
				buffer += token
				const cut = cutFirstUnit(buffer, tuning)
				if (!cut) continue
				flushed = true
				const eligible =
					!me.cancelled &&
					!me.handedOff &&
					isSpeakable(cut.sentence) &&
					!ttsPoolBusy()
				if (eligible) {
					me.firstUnitText = cut.sentence
					me.firstUnitPcm = collectPcm(ctx, cut.sentence).catch(() => null)
					domiaBusLogger.info(
						`🔮 spec-TTS priming first unit g${me.generation}: "${cut.sentence.slice(0, 40)}"`,
						{ domiaId: domia.id, interactionId },
					)
					if (cut.remaining) out.push(cut.remaining)
				} else {
					out.push(buffer)
				}
				buffer = ""
			}
			if (!flushed && buffer) out.push(buffer)
		} finally {
			out.close()
		}
	})()
}

const startSpeculation = (
	ctx: CoreBusContextType,
	args: SpeculativeTurnArgsType,
	generation: number,
	resolveTranscript: () => Promise<string>,
	llmTargets: DeliverEventTarget[] | null,
	onPartial?: (transcript: string) => void,
): SpeculationType => {
	const { domia, features } = ctx
	const specTts =
		domia.wakeWordConfig?.speculativeTtsEnabled === true &&
		features.canRunTts &&
		features.tts !== null
	const me: SpeculationType = {
		generation,
		cancelled: false,
		started: false,
		handedOff: false,
		queue: createAsyncQueue<string>(),
		outQueue: specTts ? createAsyncQueue<string>() : null,
		tokenSource: null,
		firstUnitText: null,
		firstUnitPcm: null,
		prompt: null,
		executorKey: null,
		ready: Promise.resolve(null),
	}
	me.ready = (async (): Promise<string | null> => {
		const transcript = await resolveTranscript()
		if (me.cancelled) return null
		if (!transcript.trim()) {
			domiaBusLogger.info(`🔮 speculation g${generation}: empty transcript`, {
				domiaId: domia.id,
			})
			return null
		}
		onPartial?.(transcript)
		if (skillsMayIntercept(domia) && (await looksSkillish(domia, transcript))) {
			domiaBusLogger.info(
				`🔮 speculation g${generation} skipped — skill-ish transcript ("${transcript.slice(0, 60)}")`,
				{ domiaId: domia.id },
			)
			me.queue.close()
			return transcript
		}
		if (me.cancelled) return null
		const bundle = await takeMemoryBundle(domia, args.interactionId)
		prefetchMemoryBundle(domia, args.interactionId)
		if (me.cancelled) return null
		me.prompt = buildPromptContext(domia, transcript, bundle)
		const tokens = llmTargets
			? await (async () => {
					const streamed = await streamLlmFromTarget(
						domia.domiaKey,
						llmTargets,
						{
							transcript,
							originDomiaKey: domia.domiaKey,
							interactionId: args.interactionId,
							responseType: RESPONSE_TYPE_ENUM.VOICE,
							persona: buildDelegationPersona(domia, bundle),
						},
					)
					if (!streamed.delivered || !streamed.tokens) {
						domiaBusLogger.warn(
							`🔮 speculation g${generation}: delegated LLM not delivered (${streamed.error ?? "unknown"})`,
							{ domiaId: domia.id },
						)
						return null
					}
					me.executorKey = streamed.target?.domiaKey ?? null
					return streamed.tokens
				})()
			: features.llm?.adapter.runStream?.(
					domia,
					me.prompt ?? "",
					() => me.cancelled || me.queue.isClosed(),
				)
		if (!tokens || me.cancelled) {
			if (tokens)
				void (tokens as AsyncGenerator<string>)
					.return?.(undefined)
					.catch(() => undefined)
			me.queue.close()
			return me.cancelled ? null : transcript
		}
		me.tokenSource = tokens
		me.started = true
		emitTurnEvent({
			type: DOMIA_TURN_EVENT_ENUM.SPECULATION_STARTED,
			interactionId: args.interactionId,
			originDomiaKey: domia.domiaKey,
			executorKey: me.executorKey ?? undefined,
		})
		domiaBusLogger.info(
			`🔮 speculation g${generation}: ${llmTargets ? "delegated " : ""}LLM started ("${transcript.slice(0, 60)}")`,
			{ domiaId: domia.id, interactionId: args.interactionId },
		)
		wireFirstUnitDivert(ctx, me, args.interactionId)
		if (
			features.canPlayback &&
			features.tts &&
			domia.audioPlaybackConfig?.engine === AUDIO_PLAYBACK_ENGINE_ENUM.SOX
		) {
			prewarmSoxPlayer(domia, {
				sampleRate: features.tts.adapter.capabilities.sampleRate,
				channels: features.tts.adapter.capabilities.channels,
				bitsPerSample: 16,
			})
		}
		void (async () => {
			try {
				for await (const token of tokens) {
					if (me.cancelled || me.queue.isClosed()) break
					me.queue.push(token)
				}
			} catch (err) {
				domiaBusLogger.warn(`🔮 speculation g${generation}: LLM failed`, {
					domiaId: domia.id,
					err,
				})
			} finally {
				me.queue.close()
			}
		})()
		return transcript
	})().catch((err) => {
		domiaBusLogger.warn(`🔮 speculation g${generation}: failed`, {
			domiaId: domia.id,
			err,
		})
		me.queue.close()
		return null
	})
	return me
}

const normalizeWords = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, "")
		.split(/\s+/)
		.filter(Boolean)
		.join(" ")

const transcriptsCompatible = (speculative: string, final: string): boolean =>
	normalizeWords(speculative) === normalizeWords(final)

const openSttSession = (
	ctx: CoreBusContextType,
): SttStreamSessionType | null => {
	const { domia, features } = ctx
	const create = features.stt?.adapter.createSession
	if (!create) return null
	try {
		const session = create(domia)
		domiaBusLogger.info(`🔮 incremental STT session open`, {
			domiaId: domia.id,
		})
		return session
	} catch (err) {
		domiaBusLogger.warn(
			`🔮 incremental STT unavailable — snapshot decode fallback`,
			{ domiaId: domia.id, err },
		)
		return null
	}
}

export const runSpeculativeTurn = async (
	ctx: CoreBusContextType,
	args: SpeculativeTurnArgsType,
): Promise<void> => {
	const { domia, features } = ctx
	const turnStartedAt = Date.now()
	let generation = 0
	let active: SpeculationType | null = null
	const stt = {
		session: args.existingSttSession
			? args.existingSttSession()
			: openSttSession(ctx),
	}
	const llmTargets = features.canRunLlm
		? null
		: await resolveCapabilityDelegations(domia, CAPABILITY_ENUM.LLM).then(
				(targets) => (targets.length > 0 ? targets : null),
				() => null,
			)

	const rebuildSttSession = (pcm: Buffer): void => {
		if (!stt.session) return
		stt.session.reset(pcm)
	}

	const cancelActive = (reason: string): void => {
		if (!active) return
		if (active.firstUnitPcm && !active.handedOff) {
			countSpeculationWasted(domia.id)
			domiaBusLogger.info(
				`🔮 spec_tts_wasted g${active.generation} — first-unit synth discarded (${reason})`,
				{ domiaId: domia.id, interactionId: args.interactionId },
			)
		}
		if (active.started && !active.handedOff) {
			countSpeculationDiscarded(domia.id)
			emitTurnEvent({
				type: DOMIA_TURN_EVENT_ENUM.SPECULATION_DISCARDED,
				interactionId: args.interactionId,
				originDomiaKey: domia.domiaKey,
				executorKey: active.executorKey ?? undefined,
			})
		}
		domiaBusLogger.info(
			`🔮 speculation g${active.generation} cancelled (${reason})`,
			{ domiaId: domia.id, interactionId: args.interactionId },
		)
		active.cancelled = true
		active.queue.close()
		active.outQueue?.close()
		void (active.tokenSource as AsyncGenerator<string> | null)
			?.return?.(undefined)
			.catch(() => undefined)
		active = null
	}

	let setDebounce: ((ms: number) => void) | null = null
	const onPartial = (partial: string): void => {
		const config = domia.wakeWordConfig
		if (!config?.semanticEndpointingEnabled || !setDebounce) return
		const hint = endpointHintMs(
			partial,
			config.endpointCompleteMs,
			config.endpointIncompleteMs,
			config.endpointWaitMs,
		)
		if (hint === null) return
		domiaBusLogger.info(
			`🔮 semantic endpoint → ${hint}ms ("…${partial.slice(-24)}")`,
			{ domiaId: domia.id, interactionId: args.interactionId },
		)
		setDebounce(hint)
	}

	const createCapture =
		args.captureFactory ??
		((hooks: SpeculativeCaptureHooksType) =>
			startSpeculativeCapture(domia, hooks, args.replaySinceTs))
	const capture = createCapture({
		onChunk: stt.session ? (pcm) => stt.session?.pushChunk(pcm) : undefined,
		onSpeculate: (pcm) => {
			cancelActive("superseded")
			generation += 1
			if (generation > SPECULATION_MAX_ATTEMPTS) {
				domiaBusLogger.info(
					`🔮 speculation retry budget exhausted (g${generation}) — waiting for final`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
				return
			}
			if (Date.now() - turnStartedAt > SPECULATION_MAX_UTTERANCE_MS) {
				domiaBusLogger.info(
					`🔮 utterance too long for speculation (${Date.now() - turnStartedAt}ms) — waiting for final`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
				return
			}
			const session = stt.session
			active = startSpeculation(
				ctx,
				args,
				generation,
				session
					? () =>
							session.flushPartial(
								domia.sttConfig?.decodePaddingMs ??
									DEFAULT_STT_DECODE_PADDING_MS,
							)
					: () =>
							features.stt?.adapter.runPcm?.(domia, pcm) ?? Promise.resolve(""),
				llmTargets,
				onPartial,
			)
		},
		onResume: (pcm) => {
			cancelActive("speech resumed")
			rebuildSttSession(pcm)
		},
	})
	setDebounce = capture.setDebounceMs ?? null

	void capture.filePathPromise
		.then((filePath) =>
			updateInteraction({
				id: args.interactionId,
				inputAudioPath: filePath,
			}),
		)
		.catch((err) =>
			domiaBusLogger.warn("speculative capture: audio persistence failed", {
				domiaId: domia.id,
				err,
			}),
		)

	let finalPcm: Buffer
	try {
		finalPcm = await capture.finalPcmPromise
	} catch (err) {
		cancelActive("capture aborted")
		args.release()
		domiaBusLogger.info(`🔮 speculative turn aborted before endpoint`, {
			domiaId: domia.id,
			interactionId: args.interactionId,
			err,
		})
		return
	}
	const finalTranscript = stt.session ? await stt.session.finish() : null
	const winner = active as SpeculationType | null
	if (winner && !winner.cancelled) {
		const transcript = await winner.ready
		if (transcript && !winner.cancelled) {
			const final = finalTranscript?.trim()
			const finalDisagrees =
				final !== undefined &&
				(final === "" || !transcriptsCompatible(transcript, final))
			if (finalDisagrees) {
				if (winner.started)
					emitTurnEvent({
						type: DOMIA_TURN_EVENT_ENUM.SPECULATION_DISCARDED,
						interactionId: args.interactionId,
						originDomiaKey: domia.domiaKey,
						executorKey: winner.executorKey ?? undefined,
					})
				domiaBusLogger.info(
					`🔮 speculation g${winner.generation} discarded — final decode disagrees ("${transcript.slice(0, 40)}" vs "${(final ?? "").slice(0, 40)}")`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
			} else if (winner.started) {
				winner.handedOff = true
				countSpeculationHandoff(domia.id)
				emitTurnEvent({
					type: DOMIA_TURN_EVENT_ENUM.SPECULATION_COMMITTED,
					interactionId: args.interactionId,
					originDomiaKey: domia.domiaKey,
					executorKey: winner.executorKey ?? undefined,
				})
				domiaBusLogger.info(
					`🔮 speculation g${winner.generation} confirmed — LLM already running${winner.firstUnitText ? " + first-unit TTS primed" : ""}`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
				markPipelineStart(args.interactionId)
				publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
					transcript: final || transcript,
					interactionId: args.interactionId,
					originDomiaKey: domia.domiaKey,
					prestartedTokens: winner.outQueue
						? winner.outQueue.iter()
						: winner.queue.iter(),
					prestartedPrompt: winner.prompt ?? undefined,
					prestartedExecutorKey: winner.executorKey ?? undefined,
					prestartedRelease: args.release,
					prestartedFirstUnitText: winner.firstUnitText ?? undefined,
					prestartedFirstUnitPcm: winner.firstUnitPcm ?? undefined,
					speechEndAt: capture.speechEndAt() ?? undefined,
					endpointDelayMs: capture.endpointObservedMs() ?? undefined,
					endpointDebounceMs: capture.debounceMs,
					responseType: args.publish?.responseType,
					liveVoice: args.publish?.liveVoice ?? true,
				})
				return
			}
		}
	}

	cancelActive("final decode wins")
	const transcript =
		finalTranscript ??
		(await features.stt?.adapter.runPcm?.(domia, finalPcm)) ??
		""
	domiaBusLogger.info(`🔮 no usable speculation — normal turn`, {
		domiaId: domia.id,
		interactionId: args.interactionId,
	})
	markPipelineStart(args.interactionId)
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
		transcript,
		interactionId: args.interactionId,
		originDomiaKey: domia.domiaKey,
		prestartedRelease: args.release,
		speechEndAt: capture.speechEndAt() ?? undefined,
		endpointDelayMs: capture.endpointObservedMs() ?? undefined,
		endpointDebounceMs: capture.debounceMs,
		responseType: args.publish?.responseType,
		liveVoice: args.publish?.liveVoice ?? true,
	})
}

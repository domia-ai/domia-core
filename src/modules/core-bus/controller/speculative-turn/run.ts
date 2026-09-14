import {
	publishToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	emitTurnEvent,
	DOMIA_TURN_EVENT_ENUM,
} from "@/buses"
import { domiaBusLogger } from "@/utils"
import {
	CAPABILITY_ENUM,
	DEFAULT_STT_DECODE_PADDING_MS,
	DEFAULT_SPECULATION_MAX_ATTEMPTS,
	DEFAULT_SPECULATION_MAX_UTTERANCE_MS,
	INTERACTION_STATUS_ENUM,
} from "@/db"
import {
	startSpeculativeCapture,
	type SpeculativeCaptureResultType,
	endpointHintMs,
	matchStopPhrase,
	type SpeculativeCaptureHooksType,
} from "@/modules/audio-capture"
import { markPipelineStart, updateInteraction } from "@/modules/session-manager"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import { acknowledgeEndpoint } from "@/modules/feedback-sounds"
import {
	countSpeculationHandoff,
	countSpeculationWasted,
	countSpeculationDiscarded,
	markLadderStage,
	completeInteraction,
	persistTerminal,
} from "../../utils"
import type {
	CoreBusContextType,
	SpeculationType,
	SpeculativeTurnArgsType,
} from "../../types"
import { createEagerPrefill } from "../eager-prefill"
import {
	isCancelled,
	openSttSession,
	resolveEndpointDecisionAt,
	transcriptsCompatible,
} from "./helpers"
import { startSpeculation } from "./start"

export const runSpeculativeTurn = async (
	ctx: CoreBusContextType,
	args: SpeculativeTurnArgsType,
): Promise<void> => {
	const { domia, features } = ctx
	const turnStartedAt = Date.now()
	const maxSpeculationAttempts =
		domia.wakeWordConfig?.speculationMaxAttempts ??
		DEFAULT_SPECULATION_MAX_ATTEMPTS
	const maxSpeculationUtteranceMs =
		domia.wakeWordConfig?.speculationMaxUtteranceMs ??
		DEFAULT_SPECULATION_MAX_UTTERANCE_MS
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
	const decodeSpeculation = args.decodeSpeculation !== false
	const captureRef: { current: SpeculativeCaptureResultType | null } = {
		current: null,
	}
	const eager = llmTargets
		? null
		: createEagerPrefill(ctx, args.interactionId, {
				debounceMs: () => captureRef.current?.debounceMs ?? 0,
				eagerSilenceMs: domia.wakeWordConfig?.speculativeSilenceMs ?? 0,
			})

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
			?.return(undefined)
			.catch(() => undefined)
		active = null
	}

	let setDebounce: ((ms: number) => void) | null = null
	let stopCapture: (() => void) | null = null
	const stopPhrase = { heard: null as string | null }
	const onPartial = (partial: string): void => {
		const config = domia.wakeWordConfig
		if (
			args.bargeIn &&
			config?.stopWordAbortEnabled &&
			stopPhrase.heard === null &&
			stopCapture
		) {
			const phrase = matchStopPhrase(
				partial,
				domia.characterProfile?.language,
				config.stopWordMaxWords,
				config.stopWordMaxExtraWords,
			)
			if (phrase !== null) {
				stopPhrase.heard = phrase
				domiaBusLogger.info(
					`🛑 stop word "${phrase}" on interim decode — utterance discarded`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
				stopCapture()
				return
			}
		}
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
			const session = stt.session
			const resolveTranscript = session
				? () =>
						session.flushPartial(
							domia.sttConfig?.decodePaddingMs ?? DEFAULT_STT_DECODE_PADDING_MS,
						)
				: () =>
						features.stt?.adapter.runPcm?.(domia, pcm) ?? Promise.resolve("")
			const budgetExhausted = generation > maxSpeculationAttempts
			const tooLong = Date.now() - turnStartedAt > maxSpeculationUtteranceMs
			if (decodeSpeculation && budgetExhausted)
				domiaBusLogger.info(
					`🔮 speculation retry budget exhausted (g${generation}) — waiting for final`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
			else if (decodeSpeculation && tooLong)
				domiaBusLogger.info(
					`🔮 utterance too long for speculation (${Date.now() - turnStartedAt}ms) — waiting for final`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
			else if (decodeSpeculation) {
				active = startSpeculation(
					ctx,
					args,
					generation,
					resolveTranscript,
					llmTargets,
					onPartial,
				)
				return
			}
			if (!eager) return
			if (budgetExhausted || tooLong || !eager.accepting()) {
				domiaBusLogger.debug(
					`🔥 eager decode skipped (g${generation}) — budget/exhausted`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
				return
			}
			void resolveTranscript().then(
				(partial) => {
					onPartial(partial)
					eager.onEager(partial)
				},
				(err: unknown) =>
					domiaBusLogger.warn("🔥 eager partial decode failed (best-effort)", {
						domiaId: domia.id,
						interactionId: args.interactionId,
						err,
					}),
			)
		},
		onResume: (pcm) => {
			cancelActive("speech resumed")
			eager?.onResume()
			rebuildSttSession(pcm)
		},
	})
	captureRef.current = capture
	setDebounce = capture.setDebounceMs ?? null
	stopCapture = capture.stop

	void capture.finalPcmPromise.then(
		() =>
			acknowledgeEndpoint(domia, args.interactionId, {
				playSound: false,
				sinceSpeechEndMs: capture.endpointObservedMs() ?? undefined,
			}),
		() => undefined,
	)

	void capture.filePathPromise
		.then((filePath) =>
			updateInteraction({
				id: args.interactionId,
				inputAudioPath: filePath,
			}),
		)
		.catch((err: unknown) =>
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
		eager?.discard("capture aborted")
		args.release?.()
		domiaBusLogger.info(`🔮 speculative turn aborted before endpoint`, {
			domiaId: domia.id,
			interactionId: args.interactionId,
			err,
		})
		return
	}
	if (stopPhrase.heard !== null) {
		cancelActive("stop word")
		eager?.discard("stop word")
		stt.session?.abort()
		args.release?.()
		return
	}
	const finalTranscript = await (async (): Promise<string | null> => {
		if (!stt.session) return null
		if (domia.sttConfig?.partialAtEndpointEnabled === true) {
			const partial = (await stt.session.flushPartial(0)).trim()
			if (partial) {
				stt.session.abort()
				return partial
			}
		}
		return await stt.session.finish()
	})()
	if (
		args.bargeIn &&
		domia.wakeWordConfig?.stopWordAbortEnabled &&
		finalTranscript
	) {
		const phrase = matchStopPhrase(
			finalTranscript,
			domia.characterProfile?.language,
			domia.wakeWordConfig.stopWordMaxWords,
			domia.wakeWordConfig.stopWordMaxExtraWords,
		)
		if (phrase !== null) {
			domiaBusLogger.info(
				`🛑 stop word "${phrase}" on final decode — utterance discarded`,
				{ domiaId: domia.id, interactionId: args.interactionId },
			)
			cancelActive("stop word")
			eager?.discard("stop word")
			stt.session?.abort()
			args.release?.()
			await persistTerminal(
				args.interactionId,
				INTERACTION_STATUS_ENUM.ABORTED,
				{ errorStep: "stop-word" },
			)
			completeInteraction(args.interactionId, { interrupted: true })
			return
		}
	}
	const winner = active as SpeculationType | null
	if (winner && !winner.cancelled) {
		const transcript = await winner.ready
		if (transcript && !isCancelled(winner)) {
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
					`🔮 speculation g${winner.generation} discarded — final decode disagrees ("${transcript.slice(0, 40)}" vs "${final.slice(0, 40)}")`,
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
				eager?.discard("speculation committed")
				markPipelineStart(args.interactionId)
				if (winner.llmQueuedAt)
					markLadderStage(args.interactionId, "llmQueuedAt", winner.llmQueuedAt)
				if (winner.llmFirstTokenAt)
					markLadderStage(
						args.interactionId,
						"llmFirstTokenAt",
						winner.llmFirstTokenAt,
					)
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
					endpointDecisionAt: resolveEndpointDecisionAt(capture),
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
		eagerPrefill: eager?.handle(transcript),
		speechEndAt: capture.speechEndAt() ?? undefined,
		endpointDecisionAt: resolveEndpointDecisionAt(capture),
		endpointDelayMs: capture.endpointObservedMs() ?? undefined,
		endpointDebounceMs: capture.debounceMs,
		responseType: args.publish?.responseType,
		liveVoice: args.publish?.liveVoice ?? true,
	})
}

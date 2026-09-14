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
} from "@/utils"
import {
	ensureReplyOrFallback,
	notifyInteractionFailed,
	isTurnAborted,
	notifyTurnAborted,
	recordEouMetrics,
	markLadderStage,
	recordReplyQueueWait,
	pushInteractionTranscript,
	completeInteraction,
	persistTerminal,
	resolveFastIntent,
	getInteractionRuntime,
	setInteractionTarget,
	stage,
	buildTurnSession,
	attemptFastPathRoute,
	settleEagerPrefill,
} from "../../utils"
import {
	getOrCreateInteractionId,
	updateInteraction,
} from "@/modules/session-manager"
import {
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	INTERACTION_STATUS_ENUM,
	RESPONSE_TYPE_ENUM,
	DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
} from "@/db"
import { playFeedbackSound } from "@/modules/feedback-sounds"
import { admitVoiceReply } from "@/modules/voice-admission"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import type {
	CoreBusContextType,
	SttDonePayloadType,
	PipelinePrefixType,
} from "../../types"
import { finalizeExpressedEmotion } from "./persist"
import { pipelineVoiceFromTokens } from "./pipeline"
import { tryLocalFullStreamVoice, runLocalSyncLlm } from "./local-llm"
import {
	attemptLocalSkillsRoute,
	attemptDelegatedSkillsRoute,
} from "./skills-route"
import { tryDelegatedReplyAudio, runDelegatedStreamLlm } from "./delegation"
import { handlePendingConfirmation } from "./confirmation"

const scriptMatchesLanguage = (text: string, language: string): boolean => {
	if (!languageSetsFor(language).latinScript) return true
	const letters = text.match(/\p{L}/gu) ?? []
	if (letters.length === 0) return true
	const latin = text.match(/[a-zA-Z\u00C0-\u024F]/g) ?? []
	return latin.length * 2 >= letters.length
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

const releasePrestarted = (payload: SttDonePayloadType): void => {
	payload.prestartedRelease?.()
	payload.eagerPrefill?.cancel("turn released before decode")
	const tokens = payload.prestartedTokens as AsyncGenerator<string> | undefined
	void tokens?.return(undefined).catch(() => undefined)
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
	if (!interactionId) {
		releasePrestarted(payload)
		return
	}
	setTraceContext({ interactionId, originDomiaKey })

	void updateInteraction({
		id: interactionId,
		inputRaw: transcript,
		sttResult: transcript,
	}).catch((err: unknown) =>
		domiaBusLogger.error("STT_DONE: snapshot persistence failed", {
			domiaId,
			interactionId,
			err,
		}),
	)

	const wakeWordOnly = (() => {
		const wake = domia.wakeWordConfig?.wakeWord.trim().toLowerCase()
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
		releasePrestarted(payload)
		completeInteraction(interactionId, {
			result: { transcript: "", reply: "" },
		})
		return
	}

	if (originDomiaKey) {
		if (
			await handlePendingConfirmation(
				ctx,
				payload,
				interactionId,
				transcript,
				originDomiaKey,
			)
		)
			return
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
		).catch((err: unknown) => {
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
				releasePrestarted(payload)
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
				if (!payload.prestartedTokens)
					await settleEagerPrefill(
						payload.eagerPrefill,
						interactionId,
						domia.wakeWordConfig?.twoTierSettleMaxWaitMs ??
							DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
					)
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
					void stale.return(undefined).catch(() => undefined)
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
		releasePrestarted(payload)
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

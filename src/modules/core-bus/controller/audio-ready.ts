import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import {
	domiaBusLogger,
	setTraceContext,
	toError,
	wavFileToPcmChunks,
} from "@/utils"
import {
	downloadAudioToTemp,
	heardReplyOf,
	notifyInteractionFailed,
	playStreamedAudio,
	takeMemoryBundle,
	DEFAULT_SAMPLE_RATE,
} from "../utils"
import {
	getOrCreateInteractionId,
	updateInteraction,
	markPipelineStart,
	pipelineElapsed,
} from "@/modules/session-manager"
import {
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	RESPONSE_TYPE_ENUM,
} from "@/db"
import { runSTT } from "@/modules/stt-engine"
import {
	personaContextFromDomia,
	buildPromptFromPersona,
} from "@/modules/prompt-context-builder"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import {
	streamSttToTarget,
	streamVoiceReplyFromTarget,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type {
	AudioReadyPayloadType,
	CoreBusContextType,
	PlaybackOutcomeType,
} from "../types"

const tryFusedVoiceReply = async (
	ctx: CoreBusContextType,
	args: {
		interactionId: string
		originDomiaKey: string | undefined
		audioPath: string
		speechEndAt?: number
		liveVoice?: boolean
	},
	targets: DeliverEventTarget[],
): Promise<boolean> => {
	const { domia } = ctx
	const { interactionId, originDomiaKey, audioPath } = args
	const startTime = Date.now()
	domiaBusLogger.info(
		`📡 fused voice reply delegation (${targets.length} targets)`,
		{ domiaId: domia.id, interactionId },
	)

	const { recentTurns, knownFacts, userMoodTrend } = await takeMemoryBundle(
		domia,
		interactionId,
	)
	const persona = personaContextFromDomia(
		domia,
		recentTurns,
		knownFacts,
		userMoodTrend,
	)
	const streamed = await streamVoiceReplyFromTarget(domia.domiaKey, targets, {
		originDomiaKey,
		interactionId,
		responseType: RESPONSE_TYPE_ENUM.VOICE,
		personaContextJson: JSON.stringify(persona),
		audioFactory: () => wavFileToPcmChunks(audioPath),
	})

	if (streamed.atCapacity) {
		domiaBusLogger.warn(
			`fused voice reply: hub at capacity — surfacing graceful busy (no fallback)`,
			{ domiaId: domia.id, interactionId },
		)
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
			error: "hub at capacity",
			step: "capacity",
			liveVoice: args.liveVoice,
		})
		return true
	}

	if (!streamed.delivered || !streamed.audio) {
		domiaBusLogger.warn(
			`fused voice reply failed (${streamed.error ?? "unknown"}) — falling back to split STT path`,
			{ domiaId: domia.id, interactionId },
		)
		return false
	}

	const audioIter = streamed.audio[Symbol.asyncIterator]()
	let ttfaMs: number | null = null
	let perceivedTtfaMs: number | null = null
	let audioEmitted = false

	let firstRes: IteratorResult<Buffer>
	try {
		firstRes = await audioIter.next()
	} catch (err) {
		domiaBusLogger.warn(
			`fused voice reply produced no audio (${(err as Error)?.message ?? "unknown"}) — falling back`,
			{ domiaId: domia.id, interactionId },
		)
		return false
	}
	if (firstRes.done) {
		domiaBusLogger.warn(
			`fused voice reply produced no audio — falling back to split STT path`,
			{ domiaId: domia.id, interactionId },
		)
		return false
	}

	const sampleRate = streamed.audioMeta?.sampleRate ?? DEFAULT_SAMPLE_RATE
	const channels = (streamed.audioMeta?.channels === 2 ? 2 : 1) as 1 | 2

	const timedAudio = (async function* (): AsyncIterable<Buffer> {
		try {
			ttfaMs = Date.now() - startTime
			if (args.speechEndAt) perceivedTtfaMs = Date.now() - args.speechEndAt
			audioEmitted = true
			yield firstRes.value
			while (true) {
				const next = await audioIter.next()
				if (next.done) break
				yield next.value
			}
		} finally {
			await audioIter.return?.().catch(() => undefined)
		}
	})()

	let playback: PlaybackOutcomeType = {
		filePath: undefined,
		interrupted: false,
		audioStarted: false,
	}
	try {
		playback = await playStreamedAudio(
			ctx,
			timedAudio,
			{ interactionId, originDomiaKey },
			{ sampleRate, channels },
		)
	} catch (err) {
		if (!audioEmitted) {
			domiaBusLogger.warn(
				`fused voice reply failed before any audio (${(err as Error)?.message ?? "unknown"}) — falling back`,
				{ domiaId: domia.id, interactionId },
			)
			return false
		}
		domiaBusLogger.warn(
			`fused voice reply playback failed after audio started — NOT falling back (would double-reply)`,
			{ domiaId: domia.id, interactionId, err },
		)
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			error: err as Error,
			step: "playback",
			silent: true,
			liveVoice: args.liveVoice,
		})
	}

	await audioIter.return?.().catch(() => undefined)
	const transcript = (await streamed.transcriptPromise) ?? ""
	const reply = (await streamed.finalReplyPromise) ?? ""
	domiaBusLogger.info(`⏱️ fused voice reply timings`, {
		domiaId: domia.id,
		interactionId,
		ttfaMs,
		totalMs: Date.now() - startTime,
		transcriptChars: transcript.length,
		replyChars: reply.length,
	})
	void updateInteraction({
		id: interactionId,
		sttResult: transcript,
		llmResponse: reply,
		heardReply: heardReplyOf(reply, playback),
		llmPrompt: transcript.trim()
			? buildPromptFromPersona(persona, transcript)
			: null,
		sttExecutorKey: streamed.target?.domiaKey,
		llmExecutorKey: streamed.target?.domiaKey,
		ttsExecutorKey: streamed.target?.domiaKey,
		ttsAudioPath: playback.filePath,
		ttfaMs: ttfaMs != null && ttfaMs > 0 ? ttfaMs : null,
		perceivedTtfaMs,
		totalMs: Date.now() - startTime,
	}).catch((err) =>
		domiaBusLogger.error("fused voice reply: persistence failed", {
			domiaId: domia.id,
			interactionId,
			err,
		}),
	)
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
		transcript,
		interactionId,
		originDomiaKey,
		responseType: RESPONSE_TYPE_ENUM.VOICE,
		alreadyHandled: true,
	})
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
		reply,
		interactionId,
		originDomiaKey,
		responseType: RESPONSE_TYPE_ENUM.VOICE,
		alreadyStreamed: true,
	})
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
		interactionId,
		originDomiaKey,
	})
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
		interactionId,
		originDomiaKey,
		status: playback.interrupted ? "interrupted" : "completed",
		playedLocally: playback.audioStarted,
		liveVoice: args.liveVoice,
	})
	return true
}

export const handleAudioReady = async (
	ctx: CoreBusContextType,
	payload: AudioReadyPayloadType,
): Promise<void> => {
	const { domia, features } = ctx
	const { canRunStt } = features
	const domiaId = domia.id
	const { filePath, audioUrl, originDomiaKey } = payload

	setTraceContext({ interactionId: payload.interactionId, originDomiaKey })
	domiaBusLogger.info(`🎧 AUDIO_READY received`, {
		domiaId,
		filePath,
		audioUrl,
	})
	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
		},
	)
	if (!interactionId) return
	if (filePath)
		await updateInteraction({ id: interactionId, inputAudioPath: filePath })
	markPipelineStart(interactionId)
	setTraceContext({ interactionId, originDomiaKey })
	domiaBusLogger.info(`🆕 Interaction ${interactionId}`, { domiaId })

	try {
		if (canRunStt) {
			let pathForStt = filePath
			if (!pathForStt && audioUrl) {
				domiaBusLogger.info(
					`🎧 AUDIO_READY: fetching remote audio from ${audioUrl}`,
					{ domiaId, interactionId },
				)
				pathForStt = await downloadAudioToTemp(audioUrl, interactionId)
			}
			if (!pathForStt) {
				throw new Error("AUDIO_READY: missing filePath and audioUrl")
			}
			const sttStart = Date.now()
			const transcript = await runSTT(domia, pathForStt)
			await updateInteraction({
				id: interactionId,
				sttExecutorKey: domia.domiaKey,
				sttMs: Date.now() - sttStart,
				sttModelUsed: domia.sttConfig?.modelName ?? null,
				totalMs: pipelineElapsed(interactionId),
			})
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
				transcript,
				interactionId,
				originDomiaKey,
				speechEndAt: payload.speechEndAt,
				liveVoice: payload.liveVoice,
			})
			return
		}

		const targets = await resolveCapabilityDelegations(
			domia,
			CAPABILITY_ENUM.STT,
		)
		if (targets.length === 0) {
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
				capability: CAPABILITY_ENUM.STT,
				interactionId,
				originDomiaKey,
				responseType: RESPONSE_TYPE_ENUM.VOICE,
			})
			return
		}

		let localPath = filePath
		if (!localPath && audioUrl) {
			localPath = await downloadAudioToTemp(audioUrl, interactionId)
		}
		if (!localPath) {
			throw new Error(
				"AUDIO_READY: cannot delegate without filePath or audioUrl",
			)
		}
		const audioPath: string = localPath

		if (features.canPlayback) {
			const fusedTargets = targets.filter(
				(target) =>
					target.streamingCapabilities.stt &&
					target.streamingCapabilities.llm &&
					target.streamingCapabilities.tts,
			)
			if (
				fusedTargets.length > 0 &&
				(await tryFusedVoiceReply(
					ctx,
					{
						interactionId,
						originDomiaKey,
						audioPath,
						speechEndAt: payload.speechEndAt,
						liveVoice: payload.liveVoice,
					},
					fusedTargets,
				))
			) {
				return
			}
		}

		const orderedTargets = [...targets].sort(
			(a, b) =>
				Number(b.streamingCapabilities.stt) -
				Number(a.streamingCapabilities.stt),
		)
		domiaBusLogger.info(
			`📡 streaming STT delegation (${orderedTargets.length} targets)`,
			{ domiaId, interactionId },
		)
		const streamed = await streamSttToTarget(
			domia.domiaKey,
			orderedTargets,
			{
				originDomiaKey,
				interactionId,
				responseType: RESPONSE_TYPE_ENUM.VOICE,
			},
			() => wavFileToPcmChunks(audioPath),
		)
		if (!streamed.delivered || streamed.transcript === undefined) {
			throw new Error(
				`AUDIO_READY delegation failed: ${streamed.error ?? "unknown"} (tried ${streamed.attemptedTargets})`,
			)
		}
		await updateInteraction({
			id: interactionId,
			sttExecutorKey: streamed.target?.domiaKey,
		})
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
			transcript: streamed.transcript,
			interactionId,
			originDomiaKey,
			speechEndAt: payload.speechEndAt,
			liveVoice: payload.liveVoice,
		})
	} catch (err) {
		domiaBusLogger.error("AUDIO_READY: STT or delegate failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
			error: toError(err),
			step: "stt",
			liveVoice: payload.liveVoice,
		})
	}
}

import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, setTraceContext, toError } from "@/utils"
import {
	buildAudioUrl,
	downloadAudioToTemp,
	notifyAudioFallback,
	notifyInteractionFailed,
	registerAudioForServing,
	rejectPending,
	resolvePending,
	splitSentences,
	concatStreams,
	AsyncQueue,
} from "../utils"
import { startAudioRecording, startAudioStream } from "@/modules/audio-capture"
import {
	getOrCreateInteractionId,
	updateInteraction,
} from "@/modules/session-manager"
import {
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	RESPONSE_TYPE_ENUM,
} from "@/db"
import {
	classifyInputIntent,
	buildPromptContext,
	INPUT_INTENT_TYPE_ENUM,
} from "@/modules/prompt-context-builder"
import { runSTT } from "@/modules/stt-engine"
import { runLLM } from "@/modules/llm-engine"
import { runTTS } from "@/modules/tts-engine"
import { playAudio, playAudioStream } from "@/modules/audio-playback"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import { deliverEvent } from "@/modules/grpc-client"
import { getDomiaByDomiaKey } from "@/modules/core"
import type {
	CoreBusContextType,
	AudioReadyPayloadType,
	SttDonePayloadType,
	LlmDonePayloadType,
	TtsDonePayloadType,
	AudioErrorPayloadType,
	CapabilityMissingPayloadType,
	InteractionFailedPayloadType,
} from "../types"

const recordingInProgress = new Set<string>()

export const handleWakeDetected = async (ctx: CoreBusContextType) => {
	const { domia, features } = ctx
	const { capabilities, stt, canStreamStt } = features
	const domiaId = domia.id

	domiaBusLogger.info(`🎧 WAKE_DETECTED received`, { domiaId })
	if (!capabilities.record) return

	if (recordingInProgress.has(domiaId)) {
		domiaBusLogger.warn(
			`🚫 wake_detected ignored — recording already in progress for ${domiaId}`,
		)
		return
	}
	recordingInProgress.add(domiaId)

	try {
		if (canStreamStt && stt?.adapter.runStream) {
			const interactionId = await getOrCreateInteractionId(domia, undefined, {
				inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
				responseType: RESPONSE_TYPE_ENUM.VOICE,
			})
			if (!interactionId) return
			setTraceContext({ interactionId, originDomiaKey: domia.domiaKey })

			domiaBusLogger.info(
				`🎙️ streaming STT path: capturing live audio chunks`,
				{ domiaId, interactionId },
			)
			const { chunks, filePathPromise } = startAudioStream(domia)
			const transcript = await stt.adapter.runStream(domia, chunks)
			const filePath = await filePathPromise

			await updateInteraction({
				id: interactionId,
				inputAudioPath: filePath,
				sttResult: transcript,
			})

			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
				transcript,
				interactionId,
				originDomiaKey: domia.domiaKey,
			})
			return
		}

		const filePath = await startAudioRecording(domia)
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath,
			originDomiaKey: domia.domiaKey,
		})
	} catch (err) {
		domiaBusLogger.error("WAKE_DETECTED / recording failed", { domiaId, err })
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, {
			error: toError(err),
		})
	} finally {
		recordingInProgress.delete(domiaId)
	}
}

export const handleAudioReady = async (
	ctx: CoreBusContextType,
	payload: AudioReadyPayloadType,
) => {
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
			inputAudioPath: filePath,
			inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
		},
	)
	if (!interactionId) return
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
			const transcript = await runSTT(domia, pathForStt)
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
				transcript,
				interactionId,
				originDomiaKey,
			})
		} else {
			const targets = await resolveCapabilityDelegations(
				domia,
				CAPABILITY_ENUM.STT,
			)
			if (targets.length > 0) {
				let audioUrlToForward = audioUrl
				if (!audioUrlToForward && filePath) {
					registerAudioForServing(interactionId, filePath)
					audioUrlToForward = buildAudioUrl(domia, interactionId)
				}
				if (!audioUrlToForward) {
					throw new Error(
						"AUDIO_READY: cannot delegate without filePath or audioUrl",
					)
				}
				domiaBusLogger.info(
					`📡 delegating STT (${targets.length} targets) via ${audioUrlToForward}`,
					{ domiaId, interactionId },
				)
				const result = await deliverEvent(
					domia.domiaKey,
					targets,
					"audioReady",
					{
						audioUrl: audioUrlToForward,
						originDomiaKey,
						interactionId,
					},
				)
				if (!result.delivered) {
					throw new Error(
						`AUDIO_READY delegation failed: ${result.error ?? "unknown"} (tried ${result.attemptedTargets})`,
					)
				}
			} else {
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
					capability: CAPABILITY_ENUM.STT,
					interactionId,
					originDomiaKey,
					responseType: RESPONSE_TYPE_ENUM.VOICE,
				})
			}
		}
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
		})
	}
}

export const handleSttDone = async (
	ctx: CoreBusContextType,
	payload: SttDonePayloadType,
) => {
	const { domia, features } = ctx
	const { canRunLlm, tts, llm, canFullStreamVoice } = features
	const domiaId = domia.id
	const { transcript, originDomiaKey, responseType } = payload

	setTraceContext({ interactionId: payload.interactionId, originDomiaKey })
	domiaBusLogger.info(`📝 STT_DONE: ${transcript}`, { domiaId })
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
	const emotionState = domia?.emotionState
	const characterProfile = domia?.characterProfile

	try {
		await updateInteraction({
			id: interactionId,
			inputRaw: transcript,
			sttResult: transcript,
			emotionSnapshot: emotionState,
			characterSnapshot: characterProfile,
		})
	} catch (err) {
		domiaBusLogger.error("STT_DONE: updateInteraction failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType,
			error: toError(err),
			step: "stt",
		})
		return
	}

	const inputIntent = classifyInputIntent(domia, transcript)
	const promptContext = buildPromptContext(domia, transcript)

	if (inputIntent?.type === INPUT_INTENT_TYPE_ENUM.MCP_CALL) {
		// TODO: MORE LOGIC HERE RELATED WITH THE MCP SERVERS RESPONSE.
	}

	try {
		if (canRunLlm) {
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PROCESSING_STARTED, {
				interactionId,
				originDomiaKey,
			})
			const isVoice = responseType !== RESPONSE_TYPE_ENUM.TEXT
			const canFullStream = isVoice && canFullStreamVoice && llm && tts

			if (canFullStream && llm.adapter.runStream && tts.adapter.runStream) {
				const startTime = Date.now()
				const ttsStreamQueue = new AsyncQueue<AsyncIterable<Buffer>>()
				const caps = tts.adapter.capabilities

				let firstChunkEmitted = false
				const playbackPromise = playAudioStream(
					domia,
					concatStreams(ttsStreamQueue.iter()),
					{
						sampleRate: caps.sampleRate,
						channels: caps.channels,
						bitsPerSample: 16,
						onFirstChunkWritten: () => {
							if (firstChunkEmitted) return
							firstChunkEmitted = true
							publishToDomiaBus(
								domiaId,
								DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED,
								{ interactionId, originDomiaKey },
							)
						},
					},
				)

				let fullReply = ""
				let audioFailed = false
				let audioError: unknown = null
				try {
					const llmTokens = llm.adapter.runStream(domia, promptContext)
					for await (const sentence of splitSentences(llmTokens)) {
						fullReply += (fullReply.length > 0 ? " " : "") + sentence
						ttsStreamQueue.push(tts.adapter.runStream(domia, sentence))
					}
					ttsStreamQueue.close()
					await playbackPromise
				} catch (err) {
					audioFailed = true
					audioError = err
					ttsStreamQueue.close()
				}

				domiaBusLogger.info(
					`⏱️ LLM+TTS streaming pipeline: ${Date.now() - startTime}ms`,
				)
				await updateInteraction({
					id: interactionId,
					llmPrompt: promptContext,
					llmResponse: fullReply,
					ttsEngineUsed: tts.adapter.id,
				})
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
					reply: fullReply,
					interactionId,
					originDomiaKey,
					responseType,
					alreadyStreamed: true,
				})
				if (audioFailed) {
					notifyAudioFallback(ctx, {
						interactionId,
						originDomiaKey,
						reason: "tts_failed",
						error: toError(audioError),
						reply: fullReply,
					})
				} else {
					publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
						interactionId,
						originDomiaKey,
					})
					publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
						interactionId,
						originDomiaKey,
					})
				}
				return
			}

			const startTime = Date.now()
			const reply = await runLLM(domia, promptContext)
			const endTime = Date.now()
			domiaBusLogger.info(`⏱️ LLM execution time: ${endTime - startTime}ms`)

			await updateInteraction({
				id: interactionId,
				llmPrompt: promptContext,
				llmResponse: reply,
			})

			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
				reply,
				interactionId,
				originDomiaKey,
				responseType,
			})
		} else {
			const targets = await resolveCapabilityDelegations(
				domia,
				CAPABILITY_ENUM.LLM,
			)
			if (targets.length > 0) {
				const result = await deliverEvent(domia.domiaKey, targets, "sttDone", {
					transcript,
					interactionId,
					originDomiaKey,
					responseType,
				})
				if (!result.delivered) {
					throw new Error(
						`STT_DONE delegation failed: ${result.error ?? "unknown"}`,
					)
				}
			} else {
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
					capability: CAPABILITY_ENUM.LLM,
					interactionId,
					originDomiaKey,
					responseType,
				})
			}
		}
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
		})
	}
}

export const handleLlmDone = async (
	ctx: CoreBusContextType,
	payload: LlmDonePayloadType,
) => {
	const { domia, features } = ctx
	const { canRunTts, tts, canPlayback, canStreamTts } = features
	const domiaId = domia.id
	const { reply, originDomiaKey, responseType } = payload

	setTraceContext({ interactionId: payload.interactionId, originDomiaKey })
	domiaBusLogger.info(`🗣️ LLM_DONE: ${reply}`, { domiaId })

	if (payload.alreadyStreamed) {
		domiaBusLogger.info(
			`🗣️ LLM_DONE: alreadyStreamed flag set — handleSttDone already ran TTS+playback, skipping`,
			{ domiaId, interactionId: payload.interactionId },
		)
		return
	}

	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
			responseType:
				responseType === RESPONSE_TYPE_ENUM.VOICE
					? RESPONSE_TYPE_ENUM.VOICE
					: RESPONSE_TYPE_ENUM.TEXT,
		},
	)
	if (!interactionId) return
	setTraceContext({ interactionId, originDomiaKey })

	const isTextResponse = responseType === RESPONSE_TYPE_ENUM.TEXT
	if (isTextResponse) {
		resolvePending(interactionId, reply)
		if (originDomiaKey && originDomiaKey !== domia.domiaKey) {
			const originDomia = await getDomiaByDomiaKey(originDomiaKey)
			if (originDomia) {
				await deliverEvent(
					domia.domiaKey,
					[
						{
							domiaKey: originDomia.domiaKey,
							domiaId: originDomia.id,
							localIp: originDomia.localIp,
							grpcPort: originDomia.grpcPort,
							source: "explicit",
						},
					],
					"llmDone",
					{ reply, interactionId, originDomiaKey, responseType },
				)
			}
		}
		return
	}

	try {
		if (canRunTts) {
			const canStream = canStreamTts && canPlayback

			if (canStream && tts?.adapter.runStream) {
				const caps = tts.adapter.capabilities
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED, {
					interactionId,
					originDomiaKey,
				})
				try {
					await playAudioStream(domia, tts.adapter.runStream(domia, reply), {
						sampleRate: caps.sampleRate,
						channels: caps.channels,
						bitsPerSample: 16,
					})
				} catch (err) {
					notifyAudioFallback(ctx, {
						interactionId,
						originDomiaKey,
						reason: "tts_failed",
						error: toError(err),
						reply,
					})
					return
				}
				await updateInteraction({
					id: interactionId,
					ttsEngineUsed: tts.adapter.id,
				})
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
					interactionId,
					originDomiaKey,
				})
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
					interactionId,
					originDomiaKey,
				})
			} else {
				let response: Awaited<ReturnType<typeof runTTS>> | null = null
				try {
					response = await runTTS(domia, reply)
				} catch (err) {
					notifyAudioFallback(ctx, {
						interactionId,
						originDomiaKey,
						reason: "tts_failed",
						error: toError(err),
						reply,
					})
					return
				}
				const filePath = response?.filePath
				const engineUsed = response?.engineUsed

				await updateInteraction({
					id: interactionId,
					ttsEngineUsed: engineUsed,
					ttsAudioPath: filePath,
				})

				registerAudioForServing(interactionId, filePath)
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
					filePath,
					interactionId,
					originDomiaKey,
				})
			}
		} else {
			const targets = await resolveCapabilityDelegations(
				domia,
				CAPABILITY_ENUM.TTS,
			)
			if (targets.length > 0) {
				const result = await deliverEvent(domia.domiaKey, targets, "llmDone", {
					reply,
					interactionId,
					originDomiaKey,
					responseType,
				})
				if (!result.delivered) {
					throw new Error(
						`LLM_DONE→TTS delegation failed: ${result.error ?? "unknown"}`,
					)
				}
			} else {
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
					capability: CAPABILITY_ENUM.TTS,
					interactionId,
					originDomiaKey,
					responseType,
				})
			}
		}
	} catch (err) {
		domiaBusLogger.error("LLM_DONE: TTS or delegate failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType,
			error: toError(err),
			step: "tts",
		})
	}
}

export const handleTtsDone = async (
	ctx: CoreBusContextType,
	payload: TtsDonePayloadType,
) => {
	const { domia, features } = ctx
	const { canPlayback } = features
	const domiaId = domia.id
	const { filePath, originDomiaKey, audioUrl } = payload

	setTraceContext({ interactionId: payload.interactionId, originDomiaKey })
	if (!filePath && !audioUrl) {
		domiaBusLogger.info(
			`🗣️ TTS_DONE: no filePath/audioUrl — already streamed, skipping handler`,
			{ domiaId, interactionId: payload.interactionId },
		)
		return
	}

	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
		},
	)
	if (!interactionId) return
	setTraceContext({ interactionId, originDomiaKey })

	try {
		if (canPlayback) {
			let pathToPlay = filePath
			if (audioUrl) {
				domiaBusLogger.info(`🗣️ TTS_DONE: fetching audio from ${audioUrl}`, {
					domiaId,
				})
				pathToPlay = await downloadAudioToTemp(audioUrl, interactionId)
			} else if (filePath) {
				domiaBusLogger.info(`🗣️ TTS_DONE: ${filePath}`, { domiaId })
			}
			if (pathToPlay) {
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED, {
					interactionId,
					originDomiaKey,
				})
				try {
					await playAudio(domia, pathToPlay)
				} catch (err) {
					notifyAudioFallback(ctx, {
						interactionId,
						originDomiaKey,
						reason: "playback_failed",
						error: toError(err),
					})
					return
				}
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED, {
					interactionId,
					originDomiaKey,
				})
			} else {
				notifyInteractionFailed(ctx, {
					interactionId,
					originDomiaKey,
					responseType: RESPONSE_TYPE_ENUM.VOICE,
					error: toError("TTS_DONE: missing filePath and audioUrl"),
					step: "playback",
				})
			}
		} else {
			const targets = await resolveCapabilityDelegations(
				domia,
				CAPABILITY_ENUM.PLAYBACK,
			)
			if (targets.length > 0) {
				const audioUrlBuilt = buildAudioUrl(domia, interactionId)
				const result = await deliverEvent(domia.domiaKey, targets, "ttsDone", {
					audioUrl: audioUrlBuilt,
					interactionId,
					originDomiaKey,
				})
				if (!result.delivered) {
					throw new Error(
						`TTS_DONE→playback delegation failed: ${result.error ?? "unknown"}`,
					)
				}
			} else {
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.CAPABILITY_MISSING, {
					capability: CAPABILITY_ENUM.PLAYBACK,
					interactionId,
					originDomiaKey,
					responseType: RESPONSE_TYPE_ENUM.VOICE,
				})
			}
		}
	} catch (err) {
		domiaBusLogger.error("TTS_DONE: playback or delegate failed", {
			domiaId,
			interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
			error: toError(err),
			step: "playback",
		})
	}
}

export const handleAudioError = (
	ctx: CoreBusContextType,
	payload: AudioErrorPayloadType,
) => {
	const domiaId = ctx.domia.id
	domiaBusLogger.error("❌ AUDIO_ERROR", { domiaId, error: payload.error })
}

export const handleCapabilityMissing = (
	ctx: CoreBusContextType,
	payload: CapabilityMissingPayloadType,
) => {
	const domiaId = ctx.domia.id
	const { capability, interactionId, originDomiaKey, responseType } = payload
	domiaBusLogger.error("❌ CAPABILITY_MISSING", {
		domiaId,
		capability,
	})
	if (interactionId) {
		notifyInteractionFailed(ctx, {
			interactionId,
			originDomiaKey,
			responseType,
			error: `Capability missing: ${capability}`,
			step: "capability",
		})
	}
}

export const handleInteractionFailed = (
	ctx: CoreBusContextType,
	payload: InteractionFailedPayloadType,
) => {
	const domiaId = ctx.domia.id
	domiaBusLogger.error("❌ INTERACTION_FAILED", {
		domiaId,
		interactionId: payload.interactionId,
		step: payload.step,
		error: payload.error,
	})
	if (payload.responseType === RESPONSE_TYPE_ENUM.TEXT) {
		rejectPending(payload.interactionId, toError(payload.error))
	}
}

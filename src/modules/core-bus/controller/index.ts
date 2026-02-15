import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger, toError } from "@/utils"
import {
	buildAudioUrl,
	downloadAudioToTemp,
	notifyInteractionFailed,
	registerAudioForServing,
	rejectPending,
	resolvePending,
} from "../utils"
import { startAudioRecording } from "@/modules/audio-capture"
import {
	getOrCreateInteractionId,
	updateInteraction,
} from "@/modules/session-manager"
import {
	CAPABILITY_ENUM,
	INTERACTION_INPUT_TYPE_ENUM,
	MQTT_TYPE_ENUM,
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
import { playAudio } from "@/modules/audio-playback"
import { resolveCapabilityDelegation } from "@/modules/capability-resolver"
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

export const handleWakeDetected = async (ctx: CoreBusContextType) => {
	const { domia, runtimeCapabilities } = ctx
	const { record } = runtimeCapabilities
	const domiaId = domia.id

	domiaBusLogger.info(`🎧 WAKE_DETECTED received`, { domiaId })
	if (!record) return

	try {
		const filePath = await startAudioRecording(domia)
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath,
		})
	} catch (err) {
		domiaBusLogger.error("WAKE_DETECTED / AUDIO_READY failed", { domiaId, err })
		publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR, {
			error: toError(err),
		})
	}
}

export const handleAudioReady = async (
	ctx: CoreBusContextType,
	payload: AudioReadyPayloadType,
) => {
	const { domia, runtimeCapabilities, mqttClient } = ctx
	const { stt } = runtimeCapabilities
	const domiaId = domia.id
	const { filePath, originDomiaKey } = payload

	domiaBusLogger.info(`🎧 AUDIO_READY received`, { domiaId, filePath })
	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputAudioPath: filePath,
			inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
		},
	)
	if (!interactionId) return
	domiaBusLogger.info(`🆕 Interaction ${interactionId}`, { domiaId })

	try {
		if (stt) {
			const transcript = await runSTT(domia, filePath)
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
				transcript,
				interactionId,
				originDomiaKey,
			})
		} else {
			const delegateTo = await resolveCapabilityDelegation(
				domia,
				CAPABILITY_ENUM.STT,
			)
			if (delegateTo) {
				mqttClient?.publish(
					`domia/${delegateTo?.delegateToDomiaKey}/${MQTT_TYPE_ENUM.LOCAL}/${DOMIA_EVENT_BUS_ENUM.AUDIO_READY}`,
					JSON.stringify({ filePath, originDomiaKey, interactionId }),
				)
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
	const { domia, runtimeCapabilities, mqttClient } = ctx
	const { llm } = runtimeCapabilities
	const domiaId = domia.id
	const { transcript, originDomiaKey, responseType } = payload

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
		if (llm) {
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
			const delegateTo = await resolveCapabilityDelegation(
				domia,
				CAPABILITY_ENUM.LLM,
			)
			if (delegateTo) {
				mqttClient?.publish(
					`domia/${delegateTo?.delegateToDomiaKey}/${MQTT_TYPE_ENUM.LOCAL}/${DOMIA_EVENT_BUS_ENUM.STT_DONE}`,
					JSON.stringify({
						transcript,
						interactionId,
						originDomiaKey,
						responseType,
					}),
				)
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
	const { domia, runtimeCapabilities, mqttClient } = ctx
	const { tts } = runtimeCapabilities
	const domiaId = domia.id
	const { reply, originDomiaKey, responseType } = payload

	domiaBusLogger.info(`🗣️ LLM_DONE: ${reply}`, { domiaId })
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

	const isTextResponse = responseType === RESPONSE_TYPE_ENUM.TEXT
	if (isTextResponse) {
		resolvePending(interactionId, reply)
		if (originDomiaKey && originDomiaKey !== domia.domiaKey) {
			mqttClient?.publish(
				`domia/${originDomiaKey}/${MQTT_TYPE_ENUM.LOCAL}/${DOMIA_EVENT_BUS_ENUM.LLM_DONE}`,
				JSON.stringify({
					reply,
					interactionId,
					originDomiaKey,
					responseType,
				}),
			)
		}
		return
	}

	try {
		if (tts) {
			const response = await runTTS(domia, reply)
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
		} else {
			const delegateTo = await resolveCapabilityDelegation(
				domia,
				CAPABILITY_ENUM.TTS,
			)
			if (delegateTo) {
				mqttClient?.publish(
					`domia/${delegateTo?.delegateToDomiaKey}/${MQTT_TYPE_ENUM.LOCAL}/${DOMIA_EVENT_BUS_ENUM.LLM_DONE}`,
					JSON.stringify({
						reply,
						interactionId,
						originDomiaKey,
						responseType,
					}),
				)
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
	const { domia, runtimeCapabilities, mqttClient } = ctx
	const { playback } = runtimeCapabilities
	const domiaId = domia.id
	const { filePath, originDomiaKey, audioUrl } = payload

	const interactionId = await getOrCreateInteractionId(
		domia,
		payload.interactionId,
		{
			inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
		},
	)
	if (!interactionId) return

	try {
		if (playback) {
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
				await playAudio(domia, pathToPlay)
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
			const delegateTo = await resolveCapabilityDelegation(
				domia,
				CAPABILITY_ENUM.PLAYBACK,
			)
			if (delegateTo) {
				const audioUrlBuilt = buildAudioUrl(domia, interactionId)
				mqttClient?.publish(
					`domia/${delegateTo?.delegateToDomiaKey}/${MQTT_TYPE_ENUM.LOCAL}/${DOMIA_EVENT_BUS_ENUM.TTS_DONE}`,
					JSON.stringify({
						audioUrl: audioUrlBuilt,
						interactionId,
						originDomiaKey,
					}),
				)
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

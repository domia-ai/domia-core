import { type DomiaType } from "@/modules/core"
import {
	subscribeToDomiaBus,
	publishToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
} from "@/buses"
import { domiaBusLogger } from "@/utils"
import { startAudioRecording } from "@/modules/audio-capture"

import {
	registerNewInteraction,
	updateInteraction,
} from "@/modules/session-manager"
import { INTERACTION_INPUT_TYPE_ENUM } from "@/db"
import {
	classifyInputIntent,
	buildPromptContext,
	INPUT_INTENT_TYPE_ENUM,
} from "@/modules/prompt-context-builder"
import { runSTT } from "@/modules/stt-engine"
import { runLLM } from "@/modules/llm-engine"
import { runTTS } from "@/modules/tts-engine"
import { playAudio } from "@/modules/audio-playback"

export const setupDomiaBus = (domias: DomiaType[]) => {
	for (const domia of domias) {
		const domiaId = domia.id

		domiaBusLogger.info(
			`🔗 Subscribing to bus events for DOMIA ${domia.name} (${domiaId})`,
		)

		subscribeToDomiaBus(
			domiaId,
			DOMIA_EVENT_BUS_ENUM.WAKE_DETECTED,
			async () => {
				domiaBusLogger.info(`🎧 WAKE_DETECTED received`, { domiaId })
				const filePath = await startAudioRecording(domia)
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
					filePath,
				})
			},
		)

		subscribeToDomiaBus(
			domiaId,
			DOMIA_EVENT_BUS_ENUM.AUDIO_READY,
			async ({ filePath }) => {
				domiaBusLogger.info(`🎧 AUDIO_READY received`, { domiaId, filePath })
				const { interactionId } = await registerNewInteraction(domia, {
					inputAudioPath: filePath,
					inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
				})
				domiaBusLogger.info(`🆕 Registered interaction ${interactionId}`, {
					domiaId,
				})
				const transcript = await runSTT(domia, filePath)
				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
					transcript,
					interactionId,
				})
			},
		)

		subscribeToDomiaBus(
			domiaId,
			DOMIA_EVENT_BUS_ENUM.STT_DONE,
			async ({ transcript, interactionId }) => {
				domiaBusLogger.info(`📝 STT_DONE: ${transcript}`, { domiaId })
				const emotionState = domia?.emotionState
				const characterProfile = domia?.characterProfile

				await updateInteraction({
					id: interactionId,
					inputRaw: transcript,
					sttResult: transcript,
					emotionSnapshot: emotionState,
					characterSnapshot: characterProfile,
				})

				const inputIntent = classifyInputIntent(domia, transcript)
				const promptContext = buildPromptContext(domia, transcript)

				if (inputIntent?.type === INPUT_INTENT_TYPE_ENUM.MCP_CALL) {
					// MORE LOGIC HERE RELATED WITH THE MCP SERVERS RESPONSE.
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
				})
			},
		)

		subscribeToDomiaBus(
			domiaId,
			DOMIA_EVENT_BUS_ENUM.LLM_DONE,
			async ({ reply, interactionId }) => {
				domiaBusLogger.info(`🗣️ LLM_DONE: ${reply}`, { domiaId, interactionId })
				const response = await runTTS(domia, reply)
				const filePath = response?.filePath
				const engineUsed = response?.engineUsed

				await updateInteraction({
					id: interactionId,
					ttsEngineUsed: engineUsed,
					ttsAudioPath: filePath,
				})

				publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, {
					filePath,
					interactionId,
				})
			},
		)

		subscribeToDomiaBus(
			domiaId,
			DOMIA_EVENT_BUS_ENUM.TTS_DONE,
			async ({ filePath }) => {
				domiaBusLogger.info(`🗣️ TTS_DONE: ${filePath}`, { domiaId })

				await playAudio(domia, filePath)
			},
		)

		subscribeToDomiaBus(
			domiaId,
			DOMIA_EVENT_BUS_ENUM.AUDIO_ERROR,
			({ error }) => {
				domiaBusLogger.error("❌ AUDIO_ERROR", { domiaId, error })
			},
		)
	}
}

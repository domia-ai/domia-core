import { setupCoreBus, normalizeRuntimeCapabilities } from "@/setups"
import { initialize } from "@/modules/config-engine"
import {
	requestVoiceReply,
	type RequestVoiceReplyStage,
} from "@/modules/core-bus"
import { formatDuration } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const simulateVoiceCommand = async (filePath: string) => {
	const domia = await initialize()
	if (!domia?.runtimeCapabilities) {
		devCliLogger.error(
			"❌ Could not load DOMIA from DB (run npm run dev once to seed)",
		)
		process.exit(1)
	}
	const runtimeCapabilities = normalizeRuntimeCapabilities(
		domia.runtimeCapabilities,
	)
	setupCoreBus({ domia, runtimeCapabilities })

	devCliLogger.info(`🎙️ Simulating wake → AUDIO_READY with ${filePath}`)

	const stages: Partial<Record<RequestVoiceReplyStage, number>> = {}
	const result = await requestVoiceReply(domia, filePath, {
		onStage: (stage, elapsedMs) => {
			stages[stage] = elapsedMs
		},
	})

	const sttMs = stages.stt ?? 0
	const llmMs = (stages.llm ?? 0) - sttMs
	const ttsMs = (stages.tts ?? 0) - (stages.llm ?? 0)
	const totalMs = stages.tts ?? 0

	const replyPreview =
		result.reply.length > 80 ? result.reply.slice(0, 80) + "..." : result.reply

	devCliLogger.info(
		`📝 STT_DONE @ ${formatDuration(sttMs)} — "${result.transcript}"`,
	)
	devCliLogger.info(
		`🧠 LLM_DONE @ ${formatDuration(stages.llm ?? 0)} — "${replyPreview}"`,
	)
	devCliLogger.info(`🗣️ TTS_DONE @ ${formatDuration(totalMs)}`)
	const firstChunkMs = stages.firstAudioChunk ?? totalMs
	devCliLogger.info("=== STAGE BREAKDOWN ===")
	devCliLogger.info(`  STT:         ${formatDuration(sttMs)}`)
	devCliLogger.info(`  LLM:         ${formatDuration(llmMs)}`)
	devCliLogger.info(`  TTS:         ${formatDuration(ttsMs)}`)
	devCliLogger.info(
		`  firstChunk:  ${formatDuration(firstChunkMs)}  ⭐ time-to-first-audio`,
	)
	devCliLogger.info(`  TOTAL:       ${formatDuration(totalMs)}`)
}

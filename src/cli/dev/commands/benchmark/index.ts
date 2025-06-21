import path from "path"

import { runLLM } from "@/modules/llm-engine"
import { runSTT } from "@/modules/stt-engine"
import { runTTS } from "@/modules/tts-engine"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import { getDomia, measure, formatDuration } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const benchmarkCommand = async (filePath: string) => {
	try {
		const domia = getDomia({})
		const audioPath = path.resolve(filePath)

		devCliLogger.info("📊 Starting benchmark from recorded audio...")
		const transcript = await measure(
			() => runSTT(domia, audioPath),
			(duration) => {
				devCliLogger.info(`📝 STT Time: ${formatDuration(duration)}`)
			},
		)

		const reply = await measure(
			() => {
				const ctx = buildPromptContext(domia, transcript)
				return runLLM(domia, ctx)
			},
			(duration) => {
				devCliLogger.info(`🧠 LLM Time: ${formatDuration(duration)}`)
			},
		)

		await measure(
			() => runTTS(domia, reply),
			(duration) => {
				devCliLogger.info(`🗣️ TTS Time: ${formatDuration(duration)}`)
			},
		)

		devCliLogger.info("✅ Benchmark complete.")
	} catch (error) {
		devCliLogger.error(
			"❌ Error during benchmark tests:",
			error instanceof Error ? error.message : error,
		)
	}
}

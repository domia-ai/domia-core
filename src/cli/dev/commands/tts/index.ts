import { runTTS } from "@/modules/tts-engine"
import { getDomia, measure, formatDuration } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const ttsCommand = async (text: string) => {
	try {
		const domia = getDomia({})

		devCliLogger.info("🗣️ Generating voice for:", text)
		const result = await measure(
			() => runTTS(domia, text),
			(duration) => {
				devCliLogger.info(`⏱️ TTS Response Time ${formatDuration(duration)}`)
			},
		)
		devCliLogger.info("✅ Audio generated:", result.filePath)
	} catch (error) {
		devCliLogger.error(
			"❌ Error during TTS test",
			error instanceof Error ? error.message : error,
		)
	}
}

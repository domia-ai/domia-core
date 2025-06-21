import { startAudioRecording } from "@/modules/audio-capture"
import { getDomia } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const audioRecordingCommand = async () => {
	try {
		const domia = getDomia({})
		devCliLogger.info("🎙️ Starting audio recording test...")
		const outputPath = await startAudioRecording(domia)
		devCliLogger.info("💾 Audio recorded at:", outputPath)
	} catch (error) {
		devCliLogger.error(
			"❌ Error during audio recording test:",
			error instanceof Error ? error.message : error,
		)
	}
}

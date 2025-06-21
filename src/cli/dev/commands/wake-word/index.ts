import { startCapture } from "@/modules/audio-capture"
import { getDomia } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const wakeWordCommand = async () => {
	try {
		const domia = getDomia({})

		devCliLogger.info("🎙️ Starting audio capture test...")
		await startCapture(domia, {
			onWake: () => {
				devCliLogger.info("🛎️ Wake word detected!")
			},
			onRecordingStart: () => {
				devCliLogger.info("🔴 Recording started")
			},
			onRecordingEnd: (filePath) => {
				devCliLogger.info("✅ Recording finished:", filePath)
			},
			onError: (error) => {
				devCliLogger.error("❌ Capture error:", error)
			},
		})
	} catch (error) {
		devCliLogger.error(
			"❌ Error during wake word test",
			error instanceof Error ? error.message : error,
		)
	}
}

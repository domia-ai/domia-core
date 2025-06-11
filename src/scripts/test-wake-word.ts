import "dotenv/config"

import { startCapture } from "@/modules/audio-capture"
import { getDomia } from "@/test-utils"

async function main() {
	const domia = getDomia({})

	console.log("🎙️ Starting audio capture test...")

	await startCapture(domia, {
		onWake: () => {
			console.log("🛎️ Wake word detected!")
		},
		onRecordingStart: () => {
			console.log("🔴 Recording started")
		},
		onRecordingEnd: (filePath) => {
			console.log("✅ Recording finished:", filePath)
		},
		onError: (error) => {
			console.error("❌ Capture error:", error)
		},
	})
}

main().catch((err) => {
	console.error("❌ Error during audio capture test:", err)
})

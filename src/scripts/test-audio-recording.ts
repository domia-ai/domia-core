import "dotenv/config"

import { startAudioRecording } from "@/modules/audio-capture"
import { getDomia } from "@/test-utils"

async function main() {
	const domia = getDomia({})
	console.log("🎙️ Starting audio recording test...")
	const outputPath = await startAudioRecording(domia)
	console.log("💾 Audio recorded at:", outputPath)
}

main().catch((err) => {
	console.error("❌ Error during audio recording test:", err)
})

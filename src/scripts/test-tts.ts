import "dotenv/config"
import { runTTS } from "@/modules/tts-engine"
import { getDomia } from "@/test-utils"

async function main() {
	const domia = getDomia({})

	const text = "Hey, I'm DOMIA. This is a test."
	console.log("🗣️ Generating voice for:", text)

	const result = await runTTS(domia, text)

	console.log("✅ Audio generated:", result.filePath)
}

main().catch((err) => {
	console.error("❌ Error during TTS test:", err)
})

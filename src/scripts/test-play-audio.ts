import "dotenv/config"

import fs from "fs"
import path from "path"

import { playAudio } from "@/modules/audio-playback"
import { getDomia } from "@/test-utils"

async function main() {
	const domia = getDomia({})
	const audioFile = path.resolve("tmp/mic_test_output.wav")

	if (!fs.existsSync(audioFile)) {
		console.error("❌ Audio file not found:", audioFile)
		process.exit(1)
	}

	console.log("🔊 Running STT on:", audioFile)

	const response = await playAudio(domia, audioFile)

	console.log("📝 Response result:", response)
}

main().catch((err) => {
	console.error("❌ Error during TTS test:", err)
})

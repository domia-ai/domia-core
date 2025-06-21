import fs from "fs"
import path from "path"

import { playAudio } from "@/modules/audio-playback"
import { getDomia } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const playAudioCommand = async (filePath: string) => {
	try {
		const domia = getDomia({})
		const audioFile = path.resolve(filePath)

		if (!fs.existsSync(audioFile)) {
			devCliLogger.error("❌ Audio file not found:", audioFile)
			process.exit(1)
		}

		devCliLogger.info("🔊 Running STT on:", audioFile)
		const response = await playAudio(domia, audioFile)
		devCliLogger.info("📝 Response result:", response)
	} catch (error) {
		devCliLogger.error(
			"❌ Error during play audio test",
			error instanceof Error ? error.message : error,
		)
	}
}

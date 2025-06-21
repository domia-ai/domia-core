import fs from "fs"
import path from "path"

import { runSTT } from "@/modules/stt-engine"
import { getDomia, measure, formatDuration } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const sttCommand = async (filePath: string) => {
	try {
		const domia = getDomia({})
		const audioFile = path.resolve(filePath)

		if (!fs.existsSync(audioFile)) {
			devCliLogger.error("❌ Audio file not found:", audioFile)
			process.exit(1)
		}

		devCliLogger.info("🔊 Running STT on:", audioFile)
		const transcript = await measure(
			() => runSTT(domia, audioFile),
			(duration) => {
				devCliLogger.info(`⏱️ STT Response Time ${formatDuration(duration)}`)
			},
		)
		devCliLogger.info("📝 Transcript result:", transcript)
	} catch (error) {
		devCliLogger.error(
			"❌ Error during STT test",
			error instanceof Error ? error.message : error,
		)
	}
}

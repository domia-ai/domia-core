import fs from "fs"
import path from "path"

import { runSTT } from "@/modules/stt-engine"
import { type SttEngineEnumType, STT_ENGINE_ENUM_VALUES } from "@/db"
import { getDomia, measure, formatDuration } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const sttCommand = async (
	filePath: string,
	engine?: string,
	model?: string,
	baseUrl?: string,
	apiKey?: string,
) => {
	try {
		if (
			engine &&
			!STT_ENGINE_ENUM_VALUES.includes(engine as SttEngineEnumType)
		) {
			devCliLogger.error(
				`❌ Invalid STT engine '${engine}'. Allowed: ${STT_ENGINE_ENUM_VALUES.join(", ")}`,
			)
			process.exit(1)
		}

		const domia = getDomia({
			sttConfigOverrides: {
				...(engine && { engine: engine as SttEngineEnumType }),
				...(model && { modelName: model }),
				...(baseUrl && { baseUrl }),
				...(apiKey && { apiKey }),
			},
		})
		const audioFile = path.resolve(filePath)

		if (!fs.existsSync(audioFile)) {
			devCliLogger.error("❌ Audio file not found:", audioFile)
			process.exit(1)
		}

		devCliLogger.info(
			`🔊 Running STT (${domia.sttConfig?.engine} / ${domia.sttConfig?.modelName}) on:`,
			audioFile,
		)
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

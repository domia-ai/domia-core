import { runTTS } from "@/modules/tts-engine"
import { type TtsEngineEnumType, TTS_ENGINE_ENUM_VALUES } from "@/db"
import { getDomia, measure, formatDuration } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const ttsCommand = async (
	text: string,
	engine?: string,
	voice?: string,
) => {
	try {
		if (
			engine &&
			!TTS_ENGINE_ENUM_VALUES.includes(engine as TtsEngineEnumType)
		) {
			devCliLogger.error(
				`❌ Invalid TTS engine '${engine}'. Allowed: ${TTS_ENGINE_ENUM_VALUES.join(", ")}`,
			)
			process.exit(1)
		}

		const domia = getDomia({
			ttsConfigOverrides: {
				...(engine && { engine: engine as TtsEngineEnumType }),
				...(voice && { voiceName: voice }),
			},
		})

		devCliLogger.info(
			`🗣️ Generating voice (${domia.ttsConfig?.engine} / ${domia.ttsConfig?.voiceName}) for:`,
			text,
		)
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

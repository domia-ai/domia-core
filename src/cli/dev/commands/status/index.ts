import { env } from "@/config"
import { getDomia } from "@/modules/core"
import { devCliLogger } from "@/utils"

export const statusCommand = async () => {
	try {
		const domia = await getDomia(env.DOMIA_KEY)
		if (!domia) {
			devCliLogger.error(`❌ No domia found for key ${env.DOMIA_KEY}`)
			process.exitCode = 1
			return
		}

		devCliLogger.info("📋 Domia Status Overview")
		devCliLogger.info("───────────────────────────────")
		devCliLogger.info(`🆔 ID: ${domia.id}`)
		devCliLogger.info(`🏷️  Name: ${domia.name}`)
		devCliLogger.info(
			`🔔 WW Engine: ${domia.wakeWordConfig?.engine ?? "Not configured"} ` +
				`(quant=${domia.wakeWordConfig?.quantization ?? "default"}, ` +
				`model=${domia.wakeWordConfig?.customModelPath ?? "n/a"})`,
		)
		devCliLogger.info(
			`🎧 VAD Engine: ${domia.wakeWordConfig?.vadEngine ?? "Not configured"} ` +
				`(model=${domia.wakeWordConfig?.vadModelPath ?? "n/a"})`,
		)
		devCliLogger.info(
			`📝 STT Engine: ${domia.sttConfig?.engine ?? "Not configured"} ` +
				`(model=${domia.sttConfig?.modelName ?? "n/a"}, ` +
				`quant=${domia.sttConfig?.quantization ?? "default"}, ` +
				`path=${domia.sttConfig?.modelPath ?? "n/a"}, ` +
				`url=${domia.sttConfig?.baseUrl ?? "n/a"}, ` +
				`apiKey=${domia.sttConfig?.apiKey ? "set" : "none"})`,
		)
		devCliLogger.info(
			`🧠 LLM Engine: ${domia.llmModelConfig?.engine ?? "Not configured"} ` +
				`(model=${domia.llmModelConfig?.modelName ?? "n/a"})`,
		)
		devCliLogger.info(
			`🗣️ TTS Engine: ${domia.ttsConfig?.engine ?? "Not configured"} ` +
				`(voice=${domia.ttsConfig?.voiceName ?? "n/a"}, ` +
				`quant=${domia.ttsConfig?.quantization ?? "default"}, ` +
				`path=${domia.ttsConfig?.modelPath ?? "n/a"})`,
		)
		devCliLogger.info(
			`🔉 PB Engine: ${domia.audioPlaybackConfig?.engine ?? "Not configured"}`,
		)
		devCliLogger.info("")
		devCliLogger.info("👤 Character Profile")
		devCliLogger.info("───────────────────────────────")
		devCliLogger.info(`🎭 Personality: ${domia.characterProfile?.personality}`)
		devCliLogger.info(
			`🗨️  Communication: ${domia.characterProfile?.communicationStyle}`,
		)
		devCliLogger.info(`🧬 Role: ${domia.characterProfile?.profession}`)
		devCliLogger.info(
			`👥 Relationship: ${domia.characterProfile?.relationshipType}`,
		)
		devCliLogger.info(
			`🌍 Culture: ${domia.characterProfile?.culturalBackground ?? "N/A"}`,
		)
	} catch (error) {
		devCliLogger.error("❌ Error retrieving Domia status", error)
	}
}

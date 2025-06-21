import { getDomia } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const statusCommand = async () => {
	try {
		const domia = getDomia({})

		devCliLogger.info("📋 Domia Status Overview")
		devCliLogger.info("───────────────────────────────")
		devCliLogger.info(`🆔 ID: ${domia.id}`)
		devCliLogger.info(`🏷️  Name: ${domia.name}`)
		devCliLogger.info(
			`🔔 WW Engine: ${domia.wakeWordConfig?.engine ?? "Not configured"}`,
		)
		devCliLogger.info(
			`📝 STT Engine: ${domia.sttConfig?.engine ?? "Not configured"}`,
		)
		devCliLogger.info(
			`🧠 LLM Engine: ${domia.llmModelConfig?.engine ?? "Not configured"}`,
		)
		devCliLogger.info(
			`🗣️ TTS Engine: ${domia.ttsConfig?.engine ?? "Not configured"}`,
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

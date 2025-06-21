import { runLLM } from "@/modules/llm-engine"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import { getDomia, measure, formatDuration } from "@/test-utils"
import { devCliLogger } from "@/utils"

export const llmCommand = async (prompt: string) => {
	try {
		const domia = getDomia({
			llmModelConfigOverrides: { useCompactPrompt: true },
		})
		const promptContext = buildPromptContext(domia, prompt)

		devCliLogger.info("📋 Prompt Context:")
		devCliLogger.debug(promptContext)

		devCliLogger.info("🧠 Sending prompt to LLM...")
		const reply = await measure(
			() => runLLM(domia, promptContext),
			(duration) => {
				devCliLogger.info(`⏱️ LLM Response Time ${formatDuration(duration)}`)
			},
		)
		devCliLogger.info("📝 LLM Reply:")
		devCliLogger.debug(reply)
	} catch (error) {
		devCliLogger.error(
			"❌ Error during LLM test",
			error instanceof Error ? error.message : error,
		)
	}
}

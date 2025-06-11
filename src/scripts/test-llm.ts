import "dotenv/config"

import { runLLM } from "@/modules/llm-engine"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import { getDomia } from "@/test-utils"

async function main() {
	const domia = getDomia({
		llmModelConfigOverrides: { useCompactPrompt: true },
	})
	const transcript = "Good morning, Domia. How are you feeling today?"
	const promptContext = buildPromptContext(domia, transcript)

	console.log("📋 Prompt Context:\n")
	console.log(promptContext)
	console.log("\n🧠 Sending prompt to LLM...")

	console.time("⏱️ LLM Response Time")
	const reply = await runLLM(domia, promptContext)
	console.timeEnd("⏱️ LLM Response Time")

	console.log("\n📝 LLM Reply:\n")
	console.log(reply)
}

main().catch((err) => {
	console.error("❌ Error during LLM test:", err)
})

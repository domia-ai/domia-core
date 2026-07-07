import fs from "fs"
import readline from "readline"

import { runLLM } from "@/modules/llm-engine"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import { getDomia, measure, formatDuration } from "@/test-utils"
import { devCliLogger } from "@/utils"

import type { BatchInputType, ResultType } from "./types"

export const llmBatchCommand = async (
	inputPath: string,
	outputPath: string,
) => {
	try {
		const domia = getDomia({
			llmModelConfigOverrides: { useCompactPrompt: true },
		})

		const inputStream = fs.createReadStream(inputPath)
		const rl = readline.createInterface({
			input: inputStream,
			crlfDelay: Infinity,
		})

		const outputStream = fs.createWriteStream(outputPath, { flags: "w" })
		devCliLogger.info(`📂 Reading prompts from: ${inputPath}`)
		devCliLogger.info(`💾 Writing responses to: ${outputPath}`)

		const results: ResultType[] = []

		for await (const line of rl) {
			const { transcript }: BatchInputType = JSON.parse(line)
			const prompt = buildPromptContext(domia, transcript)

			devCliLogger.info(`🧠 Prompt: "${transcript}"`)
			let durationMs = 0

			const response = await measure(
				() => runLLM(domia, prompt),
				(duration) => {
					durationMs = duration
					devCliLogger.info(`⏱️ Response Time: ${formatDuration(duration)}`)
				},
			)

			const result = {
				transcript,
				response,
				durationMs,
				duration: formatDuration(durationMs),
			}
			results.push(result)
			outputStream.write(JSON.stringify(result) + "\n")
			devCliLogger.debug(`📝 Response: ${response}`)
		}

		outputStream.close()
		devCliLogger.info("✅ Batch process completed.")

		const avg =
			results?.reduce((a, b) => a + b?.durationMs, 0) / results?.length

		const min = Math.min(...results.map((r) => r.durationMs))
		const max = Math.max(...results.map((r) => r.durationMs))

		devCliLogger.info(
			`📊 LLM Batch Report | Prompts: ${results.length} | Avg: ${(avg / 1000).toFixed(2)}s | Fastest: ${(min / 1000).toFixed(2)}s | Slowest: ${(max / 1000).toFixed(2)}s`,
		)
	} catch (error) {
		devCliLogger.error(
			"❌ Error during LLM batch test",
			error instanceof Error ? error.message : error,
		)
	}
}

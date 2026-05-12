import fs from "fs"
import path from "path"

import { runLLM } from "@/modules/llm-engine"
import { runSTT } from "@/modules/stt-engine"
import { runTTS } from "@/modules/tts-engine"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import {
	getDomia,
	measure,
	formatDuration,
	type VoiceCorpusType,
} from "@/test-utils"
import { devCliLogger } from "@/utils"
import type { BenchmarkTimingsType } from "./types"

const benchmarkOne = async (
	domia: ReturnType<typeof getDomia>,
	audioPath: string,
): Promise<BenchmarkTimingsType> => {
	let sttMs = 0
	let llmMs = 0
	let ttsMs = 0

	const transcript = await measure(
		() => runSTT(domia, audioPath),
		(d) => {
			sttMs = d
		},
	)
	const reply = await measure(
		() => {
			const ctx = buildPromptContext(domia, transcript)
			return runLLM(domia, ctx)
		},
		(d) => {
			llmMs = d
		},
	)
	await measure(
		() => runTTS(domia, reply),
		(d) => {
			ttsMs = d
		},
	)
	return { sttMs, llmMs, ttsMs, totalMs: sttMs + llmMs + ttsMs }
}

const percentile = (sorted: number[], p: number): number => {
	if (sorted.length === 0) return 0
	const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))
	return sorted[idx]
}

export const benchmarkCommand = async (
	filePath: string,
	corpusPath?: string,
) => {
	try {
		const domia = getDomia({})

		if (corpusPath) {
			const absCorpus = path.resolve(corpusPath)
			if (!fs.existsSync(absCorpus)) {
				devCliLogger.error(`❌ Corpus not found: ${absCorpus}`)
				process.exit(1)
			}
			const corpus: VoiceCorpusType = JSON.parse(
				fs.readFileSync(absCorpus, "utf8"),
			)
			devCliLogger.info(
				`📊 Engine-direct benchmark over corpus "${corpusPath}" (${corpus.entries.length} entries)`,
			)

			const allTimings: BenchmarkTimingsType[] = []
			for (let i = 0; i < corpus.entries.length; i++) {
				const entry = corpus.entries[i]
				const audioPath = path.resolve("tmp/voice-corpus", `${entry.id}.wav`)
				if (!fs.existsSync(audioPath)) {
					devCliLogger.warn(
						`[${i + 1}/${corpus.entries.length}] ${entry.id}: audio missing (run test-corpus prepare first), skipping`,
					)
					continue
				}
				devCliLogger.info(
					`[${i + 1}/${corpus.entries.length}] ${entry.id}: ${entry.text.slice(0, 50)}`,
				)
				const t = await benchmarkOne(domia, audioPath)
				allTimings.push(t)
				devCliLogger.info(
					`  total=${formatDuration(t.totalMs)} (stt=${formatDuration(t.sttMs)} llm=${formatDuration(t.llmMs)} tts=${formatDuration(t.ttsMs)})`,
				)
			}

			const sortBy = (key: keyof BenchmarkTimingsType) =>
				allTimings.map((t) => t[key]).sort((a, b) => a - b)
			const sttSorted = sortBy("sttMs")
			const llmSorted = sortBy("llmMs")
			const ttsSorted = sortBy("ttsMs")
			const totalSorted = sortBy("totalMs")

			devCliLogger.info("")
			devCliLogger.info(
				`=== ENGINE-DIRECT AGGREGATE (n=${allTimings.length}) ===`,
			)
			devCliLogger.info(
				`  STT   p50=${formatDuration(percentile(sttSorted, 50))}  p95=${formatDuration(percentile(sttSorted, 95))}`,
			)
			devCliLogger.info(
				`  LLM   p50=${formatDuration(percentile(llmSorted, 50))}  p95=${formatDuration(percentile(llmSorted, 95))}`,
			)
			devCliLogger.info(
				`  TTS   p50=${formatDuration(percentile(ttsSorted, 50))}  p95=${formatDuration(percentile(ttsSorted, 95))}`,
			)
			devCliLogger.info(
				`  TOTAL p50=${formatDuration(percentile(totalSorted, 50))}  p95=${formatDuration(percentile(totalSorted, 95))}`,
			)
			return
		}

		const audioPath = path.resolve(filePath)
		devCliLogger.info(`📊 Engine-direct benchmark on ${audioPath}`)
		const t = await benchmarkOne(domia, audioPath)
		devCliLogger.info(`📝 STT Time: ${formatDuration(t.sttMs)}`)
		devCliLogger.info(`🧠 LLM Time: ${formatDuration(t.llmMs)}`)
		devCliLogger.info(`🗣️ TTS Time: ${formatDuration(t.ttsMs)}`)
		devCliLogger.info(`✅ Total: ${formatDuration(t.totalMs)}`)
	} catch (error) {
		devCliLogger.error(
			"❌ Error during benchmark:",
			error instanceof Error ? error.message : error,
		)
	}
}

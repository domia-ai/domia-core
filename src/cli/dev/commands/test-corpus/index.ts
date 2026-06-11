import fs from "fs"
import path from "path"
import { execFileSync } from "child_process"

import { setupCoreBus, normalizeRuntimeCapabilities } from "@/setups"
import { initialize } from "@/modules/config-engine"
import { runTTS } from "@/modules/tts-engine"
import { type TtsEngineEnumType } from "@/db"
import {
	requestVoiceReply,
	type RequestVoiceReplyStage,
} from "@/modules/core-bus"
import type { DomiaType } from "@/modules/core"
import { devCliLogger } from "@/utils"
import { getDomia } from "@/test-utils"
import type { VoiceCorpusType, VoiceCorpusEntryType } from "@/test-utils"
import type { EntryTimingsType, EntryResultType, RunResultType } from "./types"

export const DEFAULT_CORPUS_PATH =
	"src/test-utils/voice-corpora/hospitality.json"
const AUDIO_DIR = path.resolve("tmp/voice-corpus")

const loadCorpus = (corpusPath: string): VoiceCorpusType => {
	const absPath = path.resolve(corpusPath)
	if (!fs.existsSync(absPath)) {
		devCliLogger.error(`❌ Corpus not found: ${absPath}`)
		process.exit(1)
	}
	return JSON.parse(fs.readFileSync(absPath, "utf8")) as VoiceCorpusType
}

const audioPathFor = (id: string): string => path.join(AUDIO_DIR, `${id}.wav`)

const percentile = (sorted: number[], p: number): number => {
	if (sorted.length === 0) return 0
	const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))
	return sorted[idx]
}

const formatDelta = (ms: number): string => {
	const sign = ms >= 0 ? "+" : "-"
	const abs = Math.abs(ms)
	const str = abs >= 1000 ? `${(abs / 1000).toFixed(1)}s` : `${abs}ms`
	return (sign + str).padStart(8)
}

const pctChange = (delta: number, base: number): string => {
	if (base === 0) return "n/a"
	const p = (delta / base) * 100
	return `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`
}

const aggregateTimings = (
	results: EntryResultType[],
): RunResultType["aggregate"] => {
	const passing = results.filter((r) => r.pass)
	const sortBy = (key: keyof EntryTimingsType) =>
		passing.map((r) => r.timings[key]).sort((a, b) => a - b)
	const sttSorted = sortBy("sttMs")
	const llmSorted = sortBy("llmMs")
	const ttsSorted = sortBy("ttsMs")
	const firstChunkSorted = sortBy("firstAudioChunkMs")
	const totalSorted = sortBy("totalMs")
	return {
		p50: {
			sttMs: percentile(sttSorted, 50),
			llmMs: percentile(llmSorted, 50),
			ttsMs: percentile(ttsSorted, 50),
			firstAudioChunkMs: percentile(firstChunkSorted, 50),
			totalMs: percentile(totalSorted, 50),
		},
		p95: {
			sttMs: percentile(sttSorted, 95),
			llmMs: percentile(llmSorted, 95),
			ttsMs: percentile(ttsSorted, 95),
			firstAudioChunkMs: percentile(firstChunkSorted, 95),
			totalMs: percentile(totalSorted, 95),
		},
	}
}

export const prepareCorpus = async (corpusPath: string) => {
	const corpus = loadCorpus(corpusPath)
	fs.mkdirSync(AUDIO_DIR, { recursive: true })

	let synthesized = 0
	let skipped = 0
	for (const entry of corpus.entries) {
		const finalPath = audioPathFor(entry.id)
		if (fs.existsSync(finalPath)) {
			skipped++
			continue
		}

		devCliLogger.info(`🗣️  Synthesizing ${entry.id}: "${entry.text}"`)
		const synthDomia = getDomia({
			ttsConfigOverrides: {
				engine: corpus.ttsEngine as TtsEngineEnumType,
				voiceName: corpus.ttsVoice,
			},
		})
		const result = await runTTS(synthDomia, entry.text)

		execFileSync("sox", [
			result.filePath,
			"-r",
			String(corpus.sampleRateHz),
			"-c",
			"1",
			finalPath,
		])
		synthesized++
	}

	devCliLogger.info(
		`✅ Prepare done. ${synthesized} synthesized, ${skipped} skipped.`,
	)
}

const failResult = (
	entry: VoiceCorpusEntryType,
	reason: string,
): EntryResultType => ({
	id: entry.id,
	category: entry.category,
	text: entry.text,
	transcript: "",
	reply: "",
	pass: false,
	failureReason: reason,
	timings: { sttMs: 0, llmMs: 0, ttsMs: 0, firstAudioChunkMs: 0, totalMs: 0 },
})

const runOneEntry = async (
	domia: DomiaType,
	entry: VoiceCorpusEntryType,
): Promise<EntryResultType> => {
	const audioPath = audioPathFor(entry.id)
	if (!fs.existsSync(audioPath)) {
		return failResult(entry, `audio missing: ${audioPath} (run prepare first)`)
	}

	try {
		const stages: Partial<Record<RequestVoiceReplyStage, number>> = {}
		const result = await requestVoiceReply(domia, audioPath, {
			timeoutMs: entry.maxTotalMs,
			onStage: (stage, elapsedMs) => {
				stages[stage] = elapsedMs
			},
		})

		const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")
		const transcriptNorm = normalize(result.transcript)
		const keywordsMatch = entry.transcriptKeywords.every((kw) =>
			transcriptNorm.includes(normalize(kw)),
		)
		const replyLong = result.reply.length >= entry.minReplyChars
		const pass = keywordsMatch && replyLong

		let failureReason: string | undefined
		if (!keywordsMatch) {
			failureReason = `keywords missing in transcript: "${result.transcript}"`
		} else if (!replyLong) {
			failureReason = `reply too short (${result.reply.length} < ${entry.minReplyChars})`
		}

		return {
			id: entry.id,
			category: entry.category,
			text: entry.text,
			transcript: result.transcript,
			reply: result.reply,
			pass,
			failureReason,
			timings: {
				sttMs: stages.stt ?? 0,
				llmMs: (stages.llm ?? 0) - (stages.stt ?? 0),
				ttsMs: (stages.tts ?? 0) - (stages.llm ?? 0),
				firstAudioChunkMs: stages.firstAudioChunk ?? stages.tts ?? 0,
				totalMs: stages.tts ?? 0,
			},
		}
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err)
		return failResult(entry, reason)
	}
}

export const runCorpus = async (corpusPath: string, outPath?: string) => {
	const corpus = loadCorpus(corpusPath)
	const domia = await initialize()
	if (!domia?.runtimeCapabilities) {
		devCliLogger.error("❌ Could not load DOMIA from DB (run npm run dev once)")
		process.exit(1)
	}
	const runtimeCapabilities = normalizeRuntimeCapabilities(
		domia.runtimeCapabilities,
	)
	setupCoreBus({ domia, runtimeCapabilities })

	devCliLogger.info(
		`🧪 Running corpus "${corpusPath}": ${corpus.entries.length} entries via DOMIA "${domia.name}"`,
	)

	const results: EntryResultType[] = []
	for (let i = 0; i < corpus.entries.length; i++) {
		const entry = corpus.entries[i]
		devCliLogger.info(
			`[${i + 1}/${corpus.entries.length}] ${entry.id} — "${entry.text}"`,
		)
		const result = await runOneEntry(domia, entry)
		results.push(result)
		const status = result.pass ? "✓" : "✗"
		const t = result.timings
		devCliLogger.info(
			`  ${status} total=${t.totalMs}ms (stt=${t.sttMs} llm=${t.llmMs} tts=${t.ttsMs}) — "${result.transcript.slice(0, 50)}"`,
		)
		if (!result.pass) {
			devCliLogger.warn(`    ↳ ${result.failureReason}`)
		}
	}

	const passed = results.filter((r) => r.pass).length
	const failed = results.length - passed
	const aggregate = aggregateTimings(results)

	const runResult: RunResultType = {
		timestamp: new Date().toISOString(),
		corpusPath,
		totalEntries: results.length,
		passed,
		failed,
		aggregate,
		entries: results,
	}

	fs.mkdirSync(AUDIO_DIR, { recursive: true })
	const outFile =
		outPath ??
		path.join(
			AUDIO_DIR,
			`run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
		)
	fs.writeFileSync(outFile, JSON.stringify(runResult, null, 2))

	devCliLogger.info("")
	devCliLogger.info(`=== SUMMARY ===`)
	devCliLogger.info(
		`${passed}/${results.length} passed | p50 total=${aggregate.p50.totalMs}ms | p95 total=${aggregate.p95.totalMs}ms`,
	)
	devCliLogger.info(
		`stages p50: stt=${aggregate.p50.sttMs}ms llm=${aggregate.p50.llmMs}ms tts=${aggregate.p50.ttsMs}ms firstChunk=${aggregate.p50.firstAudioChunkMs}ms`,
	)
	devCliLogger.info(`Written to: ${outFile}`)

	process.exit(failed === 0 ? 0 : 1)
}

export const compareCorpus = (baselinePath: string, candidatePath: string) => {
	const baseline: RunResultType = JSON.parse(
		fs.readFileSync(baselinePath, "utf8"),
	)
	const candidate: RunResultType = JSON.parse(
		fs.readFileSync(candidatePath, "utf8"),
	)

	const baselineMap = new Map(baseline.entries.map((e) => [e.id, e]))

	console.log("")
	console.log(
		`id              ${"ΔSTT".padStart(8)} ${"ΔLLM".padStart(8)} ${"ΔTTS".padStart(8)} ${"ΔTotal".padStart(8)}  verdict`,
	)
	console.log(
		`──────────────  ──────── ──────── ──────── ────────  ────────────`,
	)
	for (const cand of candidate.entries) {
		const base = baselineMap.get(cand.id)
		if (!base) {
			console.log(`${cand.id.padEnd(14)}  (new entry, no baseline)`)
			continue
		}
		const dSTT = cand.timings.sttMs - base.timings.sttMs
		const dLLM = cand.timings.llmMs - base.timings.llmMs
		const dTTS = cand.timings.ttsMs - base.timings.ttsMs
		const dTotal = cand.timings.totalMs - base.timings.totalMs
		const verdict =
			!cand.pass && base.pass
				? "✗ broke"
				: cand.pass && !base.pass
					? "✓ fixed"
					: !cand.pass && !base.pass
						? "✗ still failing"
						: dTotal < -200
							? "✓ improved"
							: dTotal > 200
								? "✗ slower"
								: "~ neutral"
		console.log(
			`${cand.id.padEnd(14)} ${formatDelta(dSTT)} ${formatDelta(dLLM)} ${formatDelta(dTTS)} ${formatDelta(dTotal)}  ${verdict}`,
		)
	}

	const dP50 = candidate.aggregate.p50.totalMs - baseline.aggregate.p50.totalMs
	const dP95 = candidate.aggregate.p95.totalMs - baseline.aggregate.p95.totalMs
	const passDelta = `${baseline.passed}/${baseline.totalEntries} → ${candidate.passed}/${candidate.totalEntries}`

	console.log("")
	console.log(
		`AGGREGATE: ΔTotal p50 ${formatDelta(dP50)} (${pctChange(dP50, baseline.aggregate.p50.totalMs)}), p95 ${formatDelta(dP95)} (${pctChange(dP95, baseline.aggregate.p95.totalMs)}), pass-rate ${passDelta}`,
	)

	const passDropped = candidate.passed < baseline.passed
	const significantSlowdown =
		baseline.aggregate.p50.totalMs > 0 &&
		dP50 / baseline.aggregate.p50.totalMs > 0.1
	if (passDropped) {
		console.log("❌ Pass-rate regressed.")
	}
	if (significantSlowdown) {
		console.log("❌ p50 total slowed by >10%.")
	}
	process.exit(passDropped || significantSlowdown ? 1 : 0)
}

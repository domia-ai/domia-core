import { readFileSync, writeFileSync, mkdirSync } from "fs"
import path from "path"
import { configSnapshot, env, meshHeaders, queryOne, sleep } from "./lib"
import type { BenchStatsType, BenchSummaryType } from "./types"

const LABEL =
	env.LABEL ??
	`run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`
const OUT_DIR = path.resolve("evals/bench-results")

const CORPUS = JSON.parse(
	readFileSync(
		path.resolve("src/test-utils/voice-corpora/golden.json"),
		"utf8",
	),
) as { golden: { id: string; text: string }[] }

const METRIC_COLS = [
	"stt_ms",
	"stt_queue_ms",
	"llm_queue_ms",
	"llm_ttft_ms",
	"llm_ms",
	"llm_tokens_per_sec",
	"llm_first_sentence_ms",
	"tts_queue_ms",
	"tts_first_chunk_ms",
	"tts_ms",
	"ttfa_ms",
	"perceived_ttfa_ms",
	"total_ms",
	"rss_mb",
	"intent_ms",
] as const

const SUMMARY_COLS = [
	"stt_ms",
	"llm_queue_ms",
	"llm_ttft_ms",
	"llm_ms",
	"llm_first_sentence_ms",
	"tts_first_chunk_ms",
	"tts_ms",
	"ttfa_ms",
	"perceived_ttfa_ms",
	"total_ms",
	"rss_mb",
] as const

type TraceMetricsType = Record<string, number | string | null>

const traceRow = (id: string): TraceMetricsType | null => {
	const row = queryOne<Record<string, unknown>>(
		`SELECT ${METRIC_COLS.join(", ")}, stt_result, status FROM interaction_trace WHERE id = ?`,
		[id],
	)
	if (!row) return null
	const out: TraceMetricsType = {}
	for (const c of METRIC_COLS) {
		const v = row[c]
		out[c] = typeof v === "number" ? v : null
	}
	out.transcript = typeof row.stt_result === "string" ? row.stt_result : ""
	out.status = typeof row.status === "string" ? row.status : ""
	return out
}

const wordOverlap = (expected: string, actual: string): number => {
	const words = (s: string): string[] =>
		s
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter(Boolean)
	const exp = words(expected)
	if (exp.length === 0) return 1
	const act = new Set(words(actual))
	return exp.filter((w) => act.has(w)).length / exp.length
}

const percentile = (xs: number[], p: number): number => {
	if (xs.length === 0) return 0
	const s = [...xs].sort((a, b) => a - b)
	const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)
	return s[Math.max(0, idx)]
}

const stats = (xs: number[]): BenchStatsType => ({
	p50: percentile(xs, 50),
	p95: percentile(xs, 95),
	min: Math.min(...xs),
	max: Math.max(...xs),
})

const summarize = (
	rows: Record<string, unknown>[],
): Record<string, BenchStatsType> => {
	const out: Record<string, BenchStatsType> = {}
	const pick = (col: string): number[] =>
		rows.map((r) => r[col] as number).filter((v) => typeof v === "number")
	for (const col of SUMMARY_COLS) {
		const xs = pick(col)
		if (xs.length) out[col] = stats(xs)
	}
	return out
}

const main = async (): Promise<void> => {
	const snapshot = configSnapshot()
	console.log(
		`=== bench:voice · label="${LABEL}" · ${env.EVAL_URL} · runs=${env.BENCH_RUNS} ===`,
	)
	for (const [k, v] of Object.entries(snapshot)) console.log(`  ${k}: ${v}`)
	console.log("")

	const rows: Record<string, unknown>[] = []
	for (let run = 1; run <= env.BENCH_RUNS; run++) {
		for (const g of CORPUS.golden) {
			const rowId = env.BENCH_RUNS > 1 ? `${g.id}#${run}` : g.id
			const filePath = path.resolve(`evals/fixtures/${g.id}.wav`)
			const res = await fetch(`${env.EVAL_URL}/voice`, {
				method: "POST",
				headers: { "content-type": "application/json", ...meshHeaders() },
				body: JSON.stringify({ filePath }),
			})
			const json = (await res.json()) as { interactionId?: string }
			if (!json.interactionId) {
				console.log(`  ${rowId} FAILED (${res.status})`)
				rows.push({ id: rowId, cold: run === 1, status: `http_${res.status}` })
				continue
			}
			let row: TraceMetricsType | null = null
			for (let i = 0; i < 25 && !row?.total_ms; i++) {
				await sleep(400)
				row = traceRow(json.interactionId)
			}
			if (!row) continue
			rows.push({ id: rowId, cold: run === 1, expectedText: g.text, ...row })
			console.log(
				`  ${rowId.padEnd(7)}  stt:${String(row.stt_ms).padStart(4)}  llmQ:${String(row.llm_queue_ms).padStart(3)}  ttft:${String(row.llm_ttft_ms).padStart(4)}  tok/s:${String(row.llm_tokens_per_sec).padStart(5)}  ttsFirst:${String(row.tts_first_chunk_ms).padStart(4)}  ttfa:${String(row.ttfa_ms).padStart(5)}  total:${String(row.total_ms).padStart(5)}  rss:${row.rss_mb}MB`,
			)
		}
	}

	const okRows = rows.filter((r) => r.status === "ok")
	const failedRows = rows.filter((r) => r.status !== "ok")
	const warmRows = okRows.filter((r) => r.cold !== true)
	const expected = CORPUS.golden.length * env.BENCH_RUNS
	const transcriptMismatches = okRows.filter(
		(r) =>
			wordOverlap(String(r.expectedText ?? ""), String(r.transcript ?? "")) <
			0.5,
	).length
	const summary: BenchSummaryType = {
		label: LABEL,
		n: okRows.length,
		expected,
		failed: failedRows.length,
		transcriptMismatches,
		runs: env.BENCH_RUNS,
		snapshot,
		all: summarize(okRows),
		...(warmRows.length ? { warm: summarize(warmRows) } : {}),
	}
	if (summary.n < expected || summary.failed > 0)
		console.warn(
			`⚠️ incomplete bench: ok=${summary.n}/${expected} failed=${summary.failed}`,
		)
	if (transcriptMismatches > 0)
		console.warn(`⚠️ transcript mismatches: ${transcriptMismatches}`)
	console.log("\n=== SUMMARY ===")
	console.log(JSON.stringify(summary, null, 2))
	mkdirSync(OUT_DIR, { recursive: true })
	const outFile = path.join(OUT_DIR, `${LABEL}.json`)
	writeFileSync(outFile, JSON.stringify({ summary, rows }, null, "\t"))
	console.log(`saved → ${outFile}`)

	const gates: [string, number | undefined, number | undefined][] = [
		["ttfa_ms", env.BENCH_TTFA_P95_MAX, summary.all.ttfa_ms?.p95],
		["total_ms", env.BENCH_TOTAL_P95_MAX, summary.all.total_ms?.p95],
	]
	let breached = false
	for (const [name, max, actual] of gates) {
		if (max == null) continue
		if (actual == null || actual > max) {
			console.error(`GATE BREACH: ${name} p95=${actual ?? "n/a"} > ${max}`)
			breached = true
		} else {
			console.log(`gate ok: ${name} p95=${actual} <= ${max}`)
		}
	}
	process.exit(breached ? 1 : 0)
}

void main().catch((e) => {
	console.error(e)
	process.exit(1)
})

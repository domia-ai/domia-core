import { execSync } from "child_process"
import { readFileSync } from "fs"
import path from "path"
import { env, getConfigModules, postModules, sleep } from "./lib"
import type { BenchStatsType } from "./types"

const OUT_DIR = path.resolve("evals/bench-results")

const BARE_MODULES = {
	emotionEngine: false,
	memoryEngine: false,
	factCapture: false,
	factRecall: false,
	skillsEngine: false,
} as const

const LAYER_KEYS = Object.keys(BARE_MODULES) as (keyof typeof BARE_MODULES)[]

const DELTA_COLS = [
	"ttfa_ms",
	"perceived_ttfa_ms",
	"llm_ttft_ms",
	"llm_first_sentence_ms",
	"tts_first_chunk_ms",
	"total_ms",
] as const

const runBench = (label: string): void => {
	execSync("npx tsx evals/bench-voice.ts", {
		stdio: "inherit",
		env: { ...process.env, LABEL: label },
	})
}

const readSummary = (label: string): Record<string, BenchStatsType> => {
	const file = path.join(OUT_DIR, `${label}.json`)
	const data = JSON.parse(readFileSync(file, "utf8")) as {
		summary: { all: Record<string, BenchStatsType> }
	}
	return data.summary.all
}

const main = async (): Promise<void> => {
	console.log(
		`=== bench:layers · ${env.EVAL_URL} · ${env.EVAL_DOMIA_KEY} · runs=${env.BENCH_RUNS} ===\n`,
	)
	const original = await getConfigModules()
	const originalLayers = Object.fromEntries(
		LAYER_KEYS.map((k) => [k, original[k]]),
	)
	console.log("current layer flags:", JSON.stringify(originalLayers))

	try {
		console.log("\n--- applying BARE config (layers off) ---")
		await postModules({ ...BARE_MODULES })
		await sleep(2000)
		runBench("layers-bare")
	} finally {
		console.log("\n--- restoring original config ---")
		await postModules(originalLayers)
		await sleep(2000)
	}

	console.log("\n--- running FULL config (restored) ---")
	runBench("layers-full")

	const bare = readSummary("layers-bare")
	const full = readSummary("layers-full")
	console.log("\n=== LAYER COST (full − bare, ms) ===")
	console.log(
		"metric".padEnd(24) +
			"bare p50".padStart(10) +
			"full p50".padStart(10) +
			"Δp50".padStart(8) +
			"bare p95".padStart(10) +
			"full p95".padStart(10) +
			"Δp95".padStart(8),
	)
	for (const col of DELTA_COLS) {
		const b = bare[col]
		const f = full[col]
		if (!b || !f) continue
		console.log(
			col.padEnd(24) +
				String(b.p50).padStart(10) +
				String(f.p50).padStart(10) +
				String(f.p50 - b.p50).padStart(8) +
				String(b.p95).padStart(10) +
				String(f.p95).padStart(10) +
				String(f.p95 - b.p95).padStart(8),
		)
	}
	const check = await getConfigModules()
	const restored = LAYER_KEYS.every((k) => check[k] === originalLayers[k])
	console.log(
		restored
			? "\nconfig restored ✓"
			: "\n⚠️ config NOT fully restored — check module_settings",
	)
	process.exit(restored ? 0 : 1)
}

void main().catch((e) => {
	console.error(e)
	process.exit(1)
})

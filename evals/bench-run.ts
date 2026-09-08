import {
	DEFAULT_BENCH_THRESHOLDS,
	BENCH_STAGE_ENUM_VALUES,
	HARDWARE_CLASS_ENUM_VALUES,
} from "@/db/constants"
import { percentile } from "@/utils"
import {
	classifyHardware,
	collectSamples,
	computeStageVerdicts,
	overallVerdict,
	resolveThresholds,
	suggestionFor,
} from "@/modules/bench/utils"
import type {
	BenchRunResultType,
	BenchTurnRowType,
} from "@/modules/bench/types"

import { makeChecker, env, meshHeaders } from "./lib"

const ctx = { sttEngine: "PARAKEET", ttsEngine: "KOKORO" }

const row = (
	id: string,
	overrides: Partial<BenchTurnRowType> = {},
): BenchTurnRowType => ({
	id,
	interactionId: `${id}-ix`,
	status: "ok",
	transcript: "",
	sttMs: 300,
	llmTtftMs: 400,
	llmMs: 2000,
	ttsMs: 600,
	toolMs: null,
	totalMs: 3000,
	...overrides,
})

const pure = (): { pass: number; fail: number } => {
	const checker = makeChecker()
	console.log("\n[pure] thresholds × measurements → verdicts")

	checker.check(
		"every hardware class has every stage threshold",
		HARDWARE_CLASS_ENUM_VALUES.every((cls) =>
			BENCH_STAGE_ENUM_VALUES.every(
				(stage) => typeof DEFAULT_BENCH_THRESHOLDS[cls][stage] === "number",
			),
		),
	)

	checker.check(
		"p95 of [1..20] is 19",
		percentile(
			[...Array(20).keys()].map((i) => i + 1),
			95,
		) === 19,
	)
	checker.check(
		"p50 of [10,20,30,40] is 20",
		percentile([10, 20, 30, 40], 50) === 20,
	)
	checker.check("percentile of empty is 0", percentile([], 95) === 0)

	const merged = resolveThresholds({ pi: { stt_ms: 42 } } as never, "pi")
	checker.check(
		"resolveThresholds merges a partial DB override on top of defaults",
		merged.stt_ms === 42 &&
			merged.total_ms === DEFAULT_BENCH_THRESHOLDS.pi.total_ms,
	)
	checker.check(
		"resolveThresholds falls back to defaults when the DB json is null",
		resolveThresholds(null, "desktop").llm_ms ===
			DEFAULT_BENCH_THRESHOLDS.desktop.llm_ms,
	)

	const okRows = [row("g01"), row("g02"), row("g03")]
	const okStages = computeStageVerdicts(
		collectSamples(okRows),
		resolveThresholds(null, "apple-silicon"),
		ctx,
	)
	checker.check(
		"all core stages ok under threshold",
		okStages.length === 5 && okStages.every((s) => s.verdict === "ok"),
		JSON.stringify(okStages.map((s) => [s.stage, s.verdict])),
	)
	checker.check(
		"tool_ms omitted when no turn used a tool",
		!okStages.some((s) => s.stage === "tool_ms"),
	)
	checker.check(
		"ok stages carry no suggestion",
		okStages.every((s) => s.suggestion === undefined),
	)
	checker.check("overall ok", overallVerdict(okStages, 0) === "ok")

	const slowRows = [
		row("g01", { llmMs: 9000, totalMs: 9800 }),
		row("g02"),
		row("g03"),
	]
	const slowStages = computeStageVerdicts(
		collectSamples(slowRows),
		resolveThresholds(null, "apple-silicon"),
		ctx,
	)
	const llm = slowStages.find((s) => s.stage === "llm_ms")
	checker.check(
		"one slow sample out of three breaches p95 → llm_ms slow",
		llm?.verdict === "slow" && llm.p95 === 9000,
		JSON.stringify(llm),
	)
	checker.check(
		"slow stage names the knob to tune",
		llm?.suggestion === suggestionFor("llm_ms", ctx) &&
			llm.suggestion.includes("llm.numPredict"),
	)
	checker.check("p50 unaffected by a single outlier", llm?.p50 === 2000)
	checker.check("overall slow", overallVerdict(slowStages, 0) === "slow")

	const toolRows = [row("g01", { toolMs: 5000 }), row("g02")]
	const toolStages = computeStageVerdicts(
		collectSamples(toolRows),
		resolveThresholds(null, "pi"),
		ctx,
	)
	const tool = toolStages.find((s) => s.stage === "tool_ms")
	checker.check(
		"tool_ms present and slow when a tool ran past the pi threshold",
		tool?.verdict === "slow" && tool.samples === 1,
		JSON.stringify(tool),
	)

	const failedRows = [
		row("g01", { status: "failed", sttMs: null, totalMs: null }),
	]
	const failedStages = computeStageVerdicts(
		collectSamples(failedRows),
		resolveThresholds(null, "sbc"),
		ctx,
	)
	checker.check(
		"failed rows contribute no samples → core stages failed",
		failedStages.length === 5 &&
			failedStages.every((s) => s.verdict === "failed" && s.samples === 0),
	)
	checker.check("overall failed", overallVerdict(failedStages, 1) === "failed")
	checker.check(
		"a failed turn forces overall failed even when measured stages are ok",
		overallVerdict(okStages, 1) === "failed",
	)

	const skippedRows = [
		row("g01"),
		row("g02", { status: "skipped", sttMs: null }),
	]
	checker.check(
		"skipped rows are excluded from samples",
		collectSamples(skippedRows).stt_ms?.length === 1,
	)

	checker.check(
		"stt suggestion points to NEMO_SPEECH for in-process engines",
		suggestionFor("stt_ms", { sttEngine: "WHISPER", ttsEngine: null }).includes(
			"NEMO_SPEECH",
		),
	)
	checker.check(
		"stt suggestion points to a smaller model for external engines",
		!suggestionFor("stt_ms", {
			sttEngine: "NEMO_SPEECH",
			ttsEngine: null,
		}).includes("NEMO_SPEECH"),
	)
	checker.check(
		"tts suggestion points to VITS unless already on VITS",
		suggestionFor("tts_ms", { sttEngine: null, ttsEngine: "KOKORO" }).includes(
			"VITS",
		) &&
			!suggestionFor("tts_ms", { sttEngine: null, ttsEngine: "VITS" }).includes(
				"→ VITS",
			),
	)

	console.log("\n[pure] hardware classification")
	checker.check(
		"darwin/arm64 → apple-silicon",
		classifyHardware("darwin", "arm64", "", false) === "apple-silicon",
	)
	checker.check(
		"darwin/x64 → desktop",
		classifyHardware("darwin", "x64", "", false) === "desktop",
	)
	checker.check(
		"linux/x64 → desktop",
		classifyHardware("linux", "x64", "", false) === "desktop",
	)
	checker.check(
		"linux/arm64 Raspberry Pi 5 → pi",
		classifyHardware(
			"linux",
			"arm64",
			"Raspberry Pi 5 Model B Rev 1.0",
			false,
		) === "pi",
	)
	checker.check(
		"linux/arm64 Jetson Orin → nvidia-jetson",
		classifyHardware(
			"linux",
			"arm64",
			"NVIDIA Jetson Orin Nano Developer Kit",
			false,
		) === "nvidia-jetson",
	)
	checker.check(
		"linux/arm64 + /etc/nv_tegra_release → nvidia-jetson",
		classifyHardware("linux", "arm64", "", true) === "nvidia-jetson",
	)
	checker.check(
		"linux/arm64 unknown board → sbc",
		classifyHardware("linux", "arm64", "Orange Pi 5", false) === "sbc",
	)
	checker.check(
		"win32/x64 → desktop",
		classifyHardware("win32", "x64", "", false) === "desktop",
	)

	return { pass: checker.passCount(), fail: checker.failCount() }
}

const live = async (): Promise<{ pass: number; fail: number } | null> => {
	if (env.EVAL_BENCH_LIVE !== "1") return null
	const reachable = await fetch(`${env.EVAL_URL}/health`)
		.then((r) => r.ok)
		.catch(() => false)
	if (!reachable) {
		console.log(`\n[live] no node at ${env.EVAL_URL} — skipped`)
		return null
	}
	const checker = makeChecker()
	console.log(
		`\n[live] POST ${env.EVAL_URL}/bench/run?domiaKey=${env.EVAL_DOMIA_KEY}`,
	)
	const res = await fetch(
		`${env.EVAL_URL}/bench/run?domiaKey=${encodeURIComponent(env.EVAL_DOMIA_KEY)}`,
		{
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify({ turns: 1 }),
		},
	)
	checker.check(`HTTP 200 (got ${res.status})`, res.status === 200)
	if (res.status !== 200) {
		console.log(await res.text())
		return { pass: checker.passCount(), fail: checker.failCount() }
	}
	const json = (await res.json()) as BenchRunResultType
	console.log(
		`  hardware=${json.hardware.hardwareClass} (${json.hardware.hardwareLabel}) verdict=${json.verdict} ok=${json.ok} turns=${JSON.stringify(json.turns)} ${json.durationMs}ms`,
	)
	for (const s of json.stages)
		console.log(
			`  ${s.stage.padEnd(12)} ${s.verdict.padEnd(6)} p50=${s.p50} p95=${s.p95} max=${s.thresholdMs}${s.suggestion ? ` → ${s.suggestion}` : ""}`,
		)
	checker.check(
		"response has hardware class",
		typeof json.hardware.hardwareClass === "string",
	)
	checker.check("response has ≥5 stage verdicts", json.stages.length >= 5)
	checker.check(
		"response merges config health",
		Array.isArray(json.health.entries),
	)
	checker.check(
		"one row per requested turn",
		json.rows.length === json.turns.requested && json.turns.requested === 1,
	)
	checker.check(
		"stage verdicts are ok|slow|failed",
		json.stages.every((s) => ["ok", "slow", "failed"].includes(s.verdict)),
	)
	return { pass: checker.passCount(), fail: checker.failCount() }
}

const main = async (): Promise<void> => {
	const p = pure()
	const l = await live()
	const pass = p.pass + (l?.pass ?? 0)
	const fail = p.fail + (l?.fail ?? 0)
	console.log(`\nbench-run: ${pass} passed, ${fail} failed`)
	if (fail > 0) process.exit(1)
}

void main().catch((e: unknown) => {
	console.error(e)
	process.exit(1)
})

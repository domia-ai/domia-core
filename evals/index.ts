import { spawnSync } from "node:child_process"

import { env } from "./lib/env"
import { probeRequirements } from "./lib/requirements"
import type {
	EvalBatteryType,
	EvalRegistrySuiteType,
	EvalRequirementType,
} from "./types"

const SUITES: EvalRegistrySuiteType[] = [
	{
		name: "turn-logic",
		file: "turn-logic.ts",
		battery: "pure",
		description: "endpointing, speculation and playback state machines",
	},
	{
		name: "parsing",
		file: "parsing.ts",
		battery: "pure",
		description: "LLM-output JSON and tool-call parsing",
	},
	{
		name: "language-scaffold",
		file: "language-scaffold.ts",
		battery: "pure",
		env: { TZ: "UTC" },
		description: "language catalogs, override semantics, spoken time",
	},
	{
		name: "config-apply",
		file: "config-apply.ts",
		battery: "pure",
		description: "config column classification + config schema coverage",
	},
	{
		name: "agnostic-gate",
		file: "agnostic-gate.ts",
		battery: "pure",
		description: "no provider vocabulary in core modules",
	},
	{
		name: "agent-loop",
		file: "agent-loop.ts",
		battery: "pure",
		description:
			"agent guards, confirmations, stale tools, provider status (mock MCP)",
	},
	{
		name: "protocols",
		file: "protocol-replay.ts",
		battery: "pure",
		description: "satellite protocol replays",
	},
	{
		name: "esphome-controller",
		file: "esphome-controller.ts",
		battery: "pure",
		description: "ESPHome controller contract",
	},
	{
		name: "esphome-adapter",
		file: "esphome-adapter.ts",
		battery: "pure",
		description: "ESPHome adapter contract",
	},
	{
		name: "fact-dedup",
		file: "fact-dedup.ts",
		battery: "pure",
		description: "fact deduplication rules",
	},
	{
		name: "reflection",
		file: "reflection.ts",
		battery: "pure",
		description: "reflection scheduling and starvation guard",
	},
	{
		name: "bench-run",
		file: "bench-run.ts",
		battery: "pure",
		env: { EVAL_BENCH_LIVE: "0" },
		description: "health-check verdict computation (pure, no live call)",
	},
	{
		name: "bench-run-live",
		file: "bench-run.ts",
		battery: "node",
		env: { EVAL_BENCH_LIVE: "1" },
		description: "health-check verdict computation with a live node call",
	},
	{
		name: "two-tier",
		file: "two-tier.ts",
		battery: "pure",
		description: "eager/final/resume endpoint state machine",
	},
	{
		name: "ttfa",
		file: "ttfa.ts",
		battery: "pure",
		description:
			"first fragment splitter, phrase cache, Wyoming chunk sequencing",
	},
	{
		name: "ears",
		file: "ears.ts",
		battery: "pure",
		description: "echo gate, stop words, wake verifier, denoiser round trip",
	},
	{
		name: "otel",
		file: "otel.ts",
		battery: "pure",
		description: "OpenTelemetry spans on a synthetic turn",
	},
	{
		name: "http-surface",
		file: "http-surface.ts",
		battery: "node",
		description: "every documented HTTP route answers with the expected status",
	},
	{
		name: "security-mesh",
		file: "security-mesh.ts",
		battery: "node",
		description:
			"mesh auth, heartbeat signatures, secret rotation, install guards",
	},
	{
		name: "trace-continuity",
		file: "trace-continuity.ts",
		battery: "node",
		description: "one traceId per turn across stages",
	},
	{
		name: "proactivity",
		file: "proactivity.ts",
		battery: "node",
		env: { TZ: "UTC" },
		description: "schedule leasing, quiet hours, budgets (+ live HTTP surface)",
	},
	{
		name: "routing",
		file: "run.ts",
		battery: "node",
		env: { EVAL_SUITES: "routing" },
		requires: ["skills"],
		description: "intent routing cases against the mock HA",
	},
	{
		name: "tools",
		file: "run.ts",
		battery: "node",
		env: { EVAL_SUITES: "tools,tools-confirm,security" },
		requires: ["skills"],
		description: "tool suites against the mock HA",
	},
	{
		name: "mock",
		file: "run.ts",
		battery: "node",
		env: { EVAL_SUITES: "home-mock,fast,chat,memory" },
		requires: ["skills"],
		description: "deterministic case runner against the in-process mock HA",
	},
	{
		name: "live",
		file: "run.ts",
		battery: "quality",
		env: { EVAL_LIVE: "1" },
		requires: ["skills", "ha"],
		description:
			"full case runner against the live node — ACTUATES REAL DEVICES on the connected Home Assistant",
	},
	{
		name: "tool-scenarios",
		file: "tool-scenarios.ts",
		battery: "tool",
		requires: ["skills", "ha"],
		description: "MT1 gates on the real Home Assistant (office light)",
	},
	{
		name: "tools-scorecard",
		file: "tools-scorecard.ts",
		battery: "tool",
		requires: ["skills", "ha"],
		description: "tool-calling scorecard",
	},
	{
		name: "fast-path-sweep",
		file: "fast-path-sweep.ts",
		battery: "tool",
		requires: ["skills"],
		description: "fast-path false-positive sweep",
	},
	{
		name: "routing-sweep",
		file: "routing-sweep.ts",
		battery: "tool",
		requires: ["skills"],
		description: "routing threshold sweep",
	},
	{
		name: "h2-regressions",
		file: "h2-regressions.ts",
		battery: "tool",
		requires: ["skills"],
		description: "skills chapter regressions",
	},
	{
		name: "adversarial",
		file: "adversarial.ts",
		battery: "node",
		description: "prompt-injection and PII guards",
	},
	{
		name: "conversation",
		file: "conversation.ts",
		battery: "quality",
		description: "conversation corpus + judge",
	},
	{
		name: "satellite-persistence",
		file: "satellite-persistence.ts",
		battery: "node",
		description: "satellite rows survive restarts",
	},
	{
		name: "fact-sync",
		file: "fact-sync-cursor.ts",
		battery: "node",
		description: "fact sync cursor across peers",
	},
	{
		name: "nemo-session",
		file: "nemo-session.ts",
		battery: "hardware",
		description: "NeMo-Speech streaming session contract",
	},
	{
		name: "stt",
		file: "stt-wer.ts",
		battery: "hardware",
		description: "STT word error rate on fixtures",
	},
	{
		name: "stt-noise",
		file: "stt-noise.ts",
		battery: "hardware",
		description: "STT under noise classes",
	},
	{
		name: "turn-hold",
		file: "turn-hold.ts",
		battery: "hardware",
		description: "acoustic turn hold",
	},
	{
		name: "voice-feel",
		file: "voice-feel-soak.ts",
		battery: "hardware",
		description: "voice-feel soak",
	},
	{
		name: "bench-voice",
		file: "bench-voice.ts",
		battery: "hardware",
		description: "golden corpus voice bench (BENCH_CORPUS=golden|golden-es)",
	},
	{
		name: "e2e",
		file: "e2e.ts",
		battery: "hardware",
		description: "end-to-end voice flow",
	},
	{
		name: "bench-layers",
		file: "bench-layers.ts",
		battery: "hardware",
		description: "bare-vs-full conversation-layer latency bench",
	},
	{
		name: "satellite-bench",
		file: "satellite-bench.ts",
		battery: "hardware",
		description: "satellite streaming latency bench",
	},
	{
		name: "tts-tournament",
		file: "tts-tournament.ts",
		battery: "hardware",
		description: "TTS engine tournament",
	},
	{
		name: "llm-tournament",
		file: "llm-tournament.ts",
		battery: "hardware",
		description: "LLM model tournament",
	},
	{
		name: "node-snapshot",
		file: "node-snapshot.ts",
		battery: "utility",
		description: "snapshot|restore a node's config, satellites and mind",
	},
	{
		name: "promote",
		file: "promote-traces.ts",
		battery: "utility",
		description: "promote live traces into eval cases",
	},
	{
		name: "gen-pauses",
		file: "gen-pauses-corpus.ts",
		battery: "utility",
		description: "generate the pauses STT corpus",
	},
]

const BATTERIES: EvalBatteryType[] = [
	"pure",
	"node",
	"tool",
	"quality",
	"hardware",
	"utility",
]
const RUNNABLE_BATTERIES: EvalBatteryType[] = [
	"pure",
	"node",
	"tool",
	"quality",
	"hardware",
]

const nodeAnswers = async (): Promise<boolean> => {
	try {
		const res = await fetch(`${env.EVAL_URL}/health`, {
			signal: AbortSignal.timeout(2000),
		})
		return res.ok
	} catch {
		return false
	}
}

const runSuite = (suite: EvalRegistrySuiteType, extra: string[]): number => {
	const child = spawnSync("npx", ["tsx", `evals/${suite.file}`, ...extra], {
		stdio: "inherit",
		env: { ...process.env, ...(suite.env ?? {}) },
	})
	return child.status ?? 1
}

const list = (): void => {
	for (const battery of BATTERIES) {
		console.log(`\n${battery}`)
		for (const s of SUITES.filter((x) => x.battery === battery))
			console.log(
				`  ${s.name.padEnd(22)} ${s.description}${s.requires ? ` [needs ${s.requires.join(", ")}]` : ""}`,
			)
	}
}

const main = async (): Promise<void> => {
	const [target, ...rawExtra] = process.argv.slice(2)
	const extra = rawExtra[0] === "--" ? rawExtra.slice(1) : rawExtra
	if (!target || target === "--list") {
		list()
		process.exit(target ? 0 : 2)
	}
	const battery = RUNNABLE_BATTERIES.find((b) => b === target)
	const selected = battery
		? SUITES.filter((s) => s.battery === battery)
		: SUITES.filter((s) => s.name === target)
	if (selected.length === 0) {
		console.error(`unknown suite or battery: ${target}`)
		list()
		process.exit(2)
	}
	const needsNode = selected.some((s) => s.battery !== "pure")
	if (needsNode && !(await nodeAnswers())) {
		console.error(
			`❌ no node answers at ${env.EVAL_URL} — start one or pick the pure battery`,
		)
		process.exit(2)
	}
	const met: Set<EvalRequirementType> = needsNode
		? probeRequirements()
		: new Set()
	const failed: string[] = []
	const skipped: string[] = []
	for (const suite of selected) {
		const unmet = (suite.requires ?? []).filter((r) => !met.has(r))
		if (unmet.length > 0) {
			console.log(`\n⏭️  ${suite.name} SKIPPED — needs ${unmet.join(", ")}`)
			skipped.push(suite.name)
			continue
		}
		console.log(`\n▶ ${suite.name}`)
		if (runSuite(suite, extra) !== 0) failed.push(suite.name)
	}
	const ran = selected.length - skipped.length
	console.log(
		`\n${battery ?? target}: ${ran - failed.length}/${ran} suites passed${skipped.length ? ` — skipped: ${skipped.join(", ")}` : ""}${failed.length ? ` — failed: ${failed.join(", ")}` : ""}`,
	)
	process.exit(failed.length === 0 ? 0 : 1)
}

void main()

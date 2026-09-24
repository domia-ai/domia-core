import { spawnSync } from "node:child_process"

import { env } from "./lib/env"
import { gateRequirements, probeRequirements } from "./lib/requirements"
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
		name: "intent-cache",
		file: "intent-cache.ts",
		battery: "pure",
		description:
			"semantic intent cache: exact/semantic hits, scope invalidation, LRU",
	},
	{
		name: "heard-prefix",
		file: "heard-prefix.ts",
		battery: "pure",
		description:
			"truncate-to-heard: sentence timing, silence trim, word boundaries",
	},
	{
		name: "tool-grammar",
		file: "tool-grammar.ts",
		battery: "pure",
		description: "GBNF tool grammar, catalog prompt block and decision parser",
	},
	{
		name: "voice-feel-rules",
		file: "voice-feel-rules.ts",
		battery: "pure",
		description:
			"voice-feel features, rule clamps, budget, cooldown and revert",
	},
	{
		name: "language-scaffold",
		file: "language-scaffold.ts",
		battery: "pure",
		env: { TZ: "UTC" },
		description: "language catalogs, override semantics, spoken time",
	},
	{
		name: "builtin-tools",
		file: "builtin-tools.ts",
		battery: "pure",
		env: { TZ: "UTC" },
		description:
			"built-in provider: packs through the fast path (EN+ES), executors, availability, lifecycle with MCP off",
	},
	{
		name: "config-apply",
		file: "config-apply.ts",
		battery: "pure",
		description: "config column classification + config schema coverage",
	},
	{
		name: "skills-reload",
		file: "skills-reload.ts",
		battery: "pure",
		description:
			"make-before-break skill provider swap on reload (mock MCP servers)",
	},
	{
		name: "node-config",
		file: "node-config.ts",
		battery: "pure",
		description: "host_node column classification, node bundle schema caps",
	},
	{
		name: "config-mirror",
		file: "config-mirror.ts",
		battery: "pure",
		description:
			"the peer config subset network-sync mirrors (llm/stt/tts) reaches a delegating node",
	},
	{
		name: "model-catalog",
		file: "model-catalog.ts",
		battery: "pure",
		description:
			"model install spec: subdir resolution, path escapes, license in GET /models",
	},
	{
		name: "tts-model-files",
		file: "tts-model-files.ts",
		battery: "pure",
		description:
			"supertonic int8/fp32 model file discovery from the bundle dir",
	},
	{
		name: "gate-requirements",
		file: "gate-requirements.ts",
		battery: "pure",
		description:
			"unmet eval requirements report a reason + recovery instead of passing silently",
	},
	{
		name: "site-map",
		file: "site-map.ts",
		battery: "pure",
		description: "tool-scenario case file, site maps and entity substitution",
	},
	{
		name: "agnostic-gate",
		file: "agnostic-gate.ts",
		battery: "pure",
		description: "no provider vocabulary in core modules",
	},
	{
		name: "fast-path-data",
		file: "fast-path-data.ts",
		battery: "pure",
		description:
			"fast-path packs as data: strict schema, every template parses+lints, slot keys, media lint, prefilters, HA compile budget",
	},
	{
		name: "agent-loop",
		file: "agent-loop.ts",
		battery: "pure",
		description:
			"agent guards, confirmations, stale tools, provider status (mock MCP)",
	},
	{
		name: "ha-intents-sweep",
		file: "ha-intents-sweep.ts",
		battery: "pure",
		description:
			"OHF-Voice HA intents corpus (en/es) through the fast path: matched / wrong tool / wrong slots / miss per intent, negatives, template compatibility",
	},
	{
		name: "music-assistant",
		file: "music-assistant.ts",
		battery: "pure",
		description:
			"music specialization: speaker matching, play planning, spoken text, virtual tools",
	},
	{
		name: "mcp-client",
		file: "mcp-client.ts",
		battery: "pure",
		description: "MCP transport, pagination, elicitation and adapter selection",
	},
	{
		name: "mock-music",
		file: "mock-music.ts",
		battery: "pure",
		description:
			"mock Music Assistant MCP server: tools, state and behavior gate",
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
		name: "audio-delivery",
		file: "audio-delivery.ts",
		battery: "pure",
		description:
			"satellite audio delivery: FLAC encoder, PCM converter, WAV reader, device formats, audio URLs",
	},
	{
		name: "external-media",
		file: "external-media.ts",
		battery: "pure",
		description:
			"external media registry: playing notes and transport controls",
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
		name: "reflection-extraction",
		file: "reflection-extraction.ts",
		battery: "pure",
		description: "fact grounding, attribution and retry predicate",
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
		description:
			"echo gate, stop words, two-stage wake verifier, denoiser round trip",
	},
	{
		name: "sherpa-gate",
		file: "sherpa-gate.ts",
		battery: "pure",
		description:
			"canonical KWS check — the gate every sherpa-onnx-node bump must pass",
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
		name: "mind-transfer",
		file: "mind-transfer.ts",
		battery: "node",
		description:
			"versioned mind export/import: secrets stripped, remap to the target identity, merge vs replace, tampered bundles rejected",
	},
	{
		name: "voice-feel-live",
		file: "voice-feel-live.ts",
		battery: "node",
		description:
			"the advisory autotuner records a recommendation and never writes config",
	},
	{
		name: "config-apply-live",
		file: "config-apply-live.ts",
		battery: "node",
		requires: [],
		description:
			"a failing engine reload reverts its config section on a live node",
	},
	{
		name: "satellite-token",
		file: "satellite-token.ts",
		battery: "pure",
		description:
			"scoped satellite tokens: mint/verify, scope binding, expiry, tampering, rotation grace",
	},
	{
		name: "security-mesh",
		file: "security-mesh.ts",
		battery: "node",
		description:
			"mesh auth, heartbeat signatures, secret rotation, install guards",
	},
	{
		name: "chat-stream",
		file: "chat-stream.ts",
		battery: "node",
		description:
			"POST /chat/stream AG-UI frame order and per-token TEXT_MESSAGE_CONTENT deltas",
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
		name: "skills-flags",
		file: "skills-flags.ts",
		battery: "node",
		requires: ["skills"],
		description:
			"builtinTools and skillsEngine toggles over /config: connections follow the flags",
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
		description:
			"MT1 gates on the real Home Assistant (EVAL_HA_SITE=mock|lab|casa)",
	},
	{
		name: "tool-scenarios-mock",
		file: "tool-scenarios.ts",
		battery: "tool",
		env: { EVAL_HA_SITE: "mock" },
		requires: ["skills"],
		description: "the tool-scenario chain against the in-process mock HA",
	},
	{
		name: "music-scenarios-mock",
		file: "tool-scenarios.ts",
		battery: "tool",
		env: {
			EVAL_SCENARIO_FILE: "music-scenarios.json",
			EVAL_MUSIC_SITE: "mock",
		},
		requires: ["skills"],
		description:
			"the music chain against the in-process mock Music Assistant + mock HA",
	},
	{
		name: "music-scenarios",
		file: "tool-scenarios.ts",
		battery: "tool",
		env: {
			EVAL_SCENARIO_FILE: "music-scenarios.json",
			EVAL_MUSIC_SITE: "casa",
		},
		requires: ["skills", "music"],
		description:
			"the music chain on the real Music Assistant (EVAL_MUSIC_SITE=casa) — PLAYS ON REAL SPEAKERS",
	},
	{
		name: "conversation-30",
		file: "conversation-long.ts",
		battery: "tool",
		env: { EVAL_HA_SITE: "mock" },
		requires: ["skills"],
		description:
			"30-turn tool-calling conversation against the in-process mock HA (branching, metrics, judge)",
	},
	{
		name: "conversation-30-live",
		file: "conversation-long.ts",
		battery: "quality",
		env: { EVAL_LIVE: "1" },
		requires: ["skills", "ha"],
		description:
			"the 30-turn conversation on the real Home Assistant (EVAL_HA_SITE=lab|casa) — ACTUATES REAL DEVICES",
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
		name: "judge-stability",
		file: "judge-stability.ts",
		battery: "quality",
		description:
			"replays the newest stored conversation transcripts through the judge panel and reports repetition stability + cross-judge agreement (EVAL_JUDGE_MODELS)",
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
		name: "sync-streams",
		file: "sync-streams.ts",
		battery: "node",
		description:
			"tool-run, episode, knowledge, voice-feel and evidence streams page on independent cursors",
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
		name: "stt-denoise",
		file: "stt-denoise.ts",
		battery: "pure",
		description:
			"denoiser engines over the noisy STT fixtures — WER must not regress",
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
		name: "tool-grammar-llm",
		file: "tool-grammar-llm.ts",
		battery: "hardware",
		description:
			"grammar-native tool decisions against the real llama-server engine path",
	},
	{
		name: "turn-tag-llm",
		file: "turn-tag-llm.ts",
		battery: "hardware",
		description:
			"single-token turn mark reliability (+ ~ #) on the real LLM, EN+ES corpus",
	},
	{
		name: "mind-dump",
		file: "mind-dump.ts",
		battery: "utility",
		description:
			"STRICT lossless mind snapshot: dump | verify | restore | counts over the 12 mind-transfer tables (remaps domia_id by key; use before/after every db:reset)",
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
	{
		name: "gen-ha-intents",
		file: "gen-ha-intents.ts",
		battery: "utility",
		description:
			"regenerate evals/fixtures/ha-intents from project-references/intents (HA_INTENTS_DIR)",
	},
	{
		name: "gen-ha-descriptors",
		file: "gen-ha-descriptors.ts",
		battery: "utility",
		description:
			"regenerate home-assistant/descriptors/{en,es}.json from project-references/intents (HA_INTENTS_DIR) merged with descriptors/base",
	},
	{
		name: "gen-website-data",
		file: "gen-website-data.ts",
		battery: "utility",
		description:
			"regenerate domia-website/src/data/{fast-path,skills}.json from the fast-path packs, registries and corpus baseline (WEBSITE_DATA_DIR)",
	},
	{
		name: "descriptor-resource",
		file: "descriptor-resource.ts",
		battery: "pure",
		description:
			"MCP-shipped domia://descriptor: templates compiled, policy stripped, limits, precedence, persistence",
	},
	{
		name: "routines",
		file: "routines.ts",
		battery: "pure",
		description:
			"user-defined routines: advertised as built-in tools, fast-path phrases, sequential steps, inherited policy, validation (mock HA + MA)",
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
	const allowSkip = env.EVAL_ALLOW_SKIP === "1"
	const failed: string[] = []
	const skipped: string[] = []
	const gated: string[] = []
	for (const suite of selected) {
		const unmet = gateRequirements(suite.requires, met)
		if (unmet.length > 0) {
			if (allowSkip) {
				console.log(
					`\n⏭️  ${suite.name} SKIPPED — needs ${unmet.map((u) => u.requirement).join(", ")} (EVAL_ALLOW_SKIP=1)`,
				)
				skipped.push(suite.name)
				continue
			}
			console.error(
				`\n❌ ${suite.name} CANNOT RUN — missing ${unmet.map((u) => u.requirement).join(", ")}`,
			)
			for (const u of unmet) {
				console.error(`   ${u.requirement}: ${u.reason}`)
				console.error(`   recover with: ${u.recovery}`)
			}
			console.error(
				"   set EVAL_ALLOW_SKIP=1 to skip unmet suites instead of failing",
			)
			gated.push(suite.name)
			continue
		}
		console.log(`\n▶ ${suite.name}`)
		if (runSuite(suite, extra) !== 0) failed.push(suite.name)
	}
	const ran = selected.length - skipped.length - gated.length
	console.log(
		`\n${battery ?? target}: ${ran - failed.length}/${ran} suites passed${skipped.length ? ` — skipped: ${skipped.join(", ")}` : ""}${gated.length ? ` — BLOCKED (unmet requirements): ${gated.join(", ")}` : ""}${failed.length ? ` — failed: ${failed.join(", ")}` : ""}`,
	)
	process.exit(failed.length === 0 && gated.length === 0 ? 0 : 1)
}

void main()

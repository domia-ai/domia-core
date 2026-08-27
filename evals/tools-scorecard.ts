import { execFileSync } from "child_process"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { postConfig, postChat, waitForHealth, sleep } from "./lib"
import type { EvalCaseResultType } from "./types"

const MODELS = ["llama3.2:3b", "granite4:micro"]
const MODES = ["native", "structured"]
const INCUMBENT = "llama3.2:3b"
const RESULTS_DIR = join(process.cwd(), "evals", "results")
const BENCH_DIR = join(process.cwd(), "evals", "bench-results")

type ScoreType = {
	model: string
	mode: string
	gatePassed: number
	gateTotal: number
	casesPassed: number
	casesTotal: number
	failures: string[]
}

const runSuite = (label: string): EvalCaseResultType[] => {
	try {
		execFileSync("npx", ["tsx", "evals/run.ts"], {
			env: {
				...process.env,
				EVAL_SUITES: "tools,home-mock,fast",
				LABEL: label,
			},
			stdio: "inherit",
			timeout: 1_800_000,
		})
	} catch {
		/* gate failures exit 1 — results file still written */
	}
	const raw = JSON.parse(
		readFileSync(join(RESULTS_DIR, `${label}.json`), "utf8"),
	) as { results: EvalCaseResultType[] }
	return raw.results
}

const scoreOf = (
	model: string,
	decisionMode: string,
	results: EvalCaseResultType[],
): ScoreType => {
	const gates = results.filter((r) => r.mode === "gate")
	return {
		model,
		mode: decisionMode,
		gatePassed: gates.filter((r) => r.passed).length,
		gateTotal: gates.length,
		casesPassed: results.filter((r) => r.passed).length,
		casesTotal: results.length,
		failures: results
			.filter((r) => !r.passed)
			.map((r) => `[${r.suite}] ${r.name} (${r.runsPassed}/${r.runs})`),
	}
}

const setModel = async (model: string, mode: string): Promise<void> => {
	for (let attempt = 0; attempt < 3; attempt++) {
		await waitForHealth(30000)
		try {
			await postConfig({
				llm: {
					modelName: model,
					toolModelName: model,
					agentDecisionMode: mode,
				},
			})
			return
		} catch {
			await sleep(2000)
		}
	}
	throw new Error(`could not set model ${model} mode ${mode}`)
}

const main = async (): Promise<void> => {
	if (!(await waitForHealth())) {
		console.error("node not reachable")
		process.exit(2)
	}
	const scores: ScoreType[] = []
	try {
		for (const model of MODELS) {
			for (const mode of MODES) {
				console.log(`\n▶▶ scorecard model: ${model} mode: ${mode}`)
				await setModel(model, mode)
				await sleep(2000)
				await waitForHealth(30000)
				await postChat("hello").catch(() => undefined)
				const results = runSuite(
					`scorecard-${model.replace(/[^a-z0-9]+/gi, "-")}-${mode}`,
				)
				scores.push(scoreOf(model, mode, results))
			}
		}
	} finally {
		await waitForHealth(30000)
		await postConfig({
			llm: {
				modelName: INCUMBENT,
				toolModelName: null,
				agentDecisionMode: "native",
			},
		}).catch(() => undefined)
	}
	mkdirSync(BENCH_DIR, { recursive: true })
	const artifact = {
		timestamp: new Date().toISOString(),
		suites: "tools,home-mock,fast",
		scores,
	}
	writeFileSync(
		join(BENCH_DIR, "tools-scorecard-mac.json"),
		JSON.stringify(artifact, null, "\t"),
	)
	const md = [
		"# Tools scorecard (Mac) — model × decision mode × tools/home-mock/fast suites",
		"",
		`Run: ${artifact.timestamp}`,
		"",
		"| model | mode | gates | cases | failures |",
		"|---|---|---|---|---|",
		...scores.map(
			(s) =>
				`| ${s.model} | ${s.mode} | ${s.gatePassed}/${s.gateTotal} | ${s.casesPassed}/${s.casesTotal} | ${s.failures.join("; ") || "—"} |`,
		),
	].join("\n")
	writeFileSync(join(BENCH_DIR, "tools-scorecard-mac.md"), md)
	console.log(`\n${md}`)
}

void main()

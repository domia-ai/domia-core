import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import { waitForHealth, postChat, pollRecord, assertTurn } from "./lib"
import type {
	EvalCaseType,
	EvalCaseResultType,
	EvalAssertionType,
} from "./types"

const CASES_DIR = join(process.cwd(), "evals", "cases")
const SUITES = process.env.EVAL_SUITES?.split(",").map((s) => s.trim())
const LIVE = process.env.EVAL_LIVE === "1"

const loadCases = (): EvalCaseType[] => {
	const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json"))
	const cases: EvalCaseType[] = []
	for (const f of files) {
		const parsed = JSON.parse(
			readFileSync(join(CASES_DIR, f), "utf8"),
		) as EvalCaseType[]
		cases.push(...parsed)
	}
	return cases.filter((c) => {
		if (c.suite === "home-live" && !LIVE) return false
		if (SUITES && !SUITES.includes(c.suite)) return false
		return true
	})
}

const runCaseOnce = async (c: EvalCaseType): Promise<EvalAssertionType[]> => {
	const all: EvalAssertionType[] = []
	for (const turn of c.turns) {
		const { interactionId, reply } = await postChat(turn.text)
		const needsTool = Boolean(
			turn.expect.tool || turn.expect.argsSubset || turn.expect.argMatchers,
		)
		const rec = await pollRecord(interactionId, needsTool)
		if (!rec) {
			all.push({
				name: `${turn.text} → record`,
				ok: false,
				detail: "no trace row",
			})
			continue
		}
		all.push(...assertTurn(rec, reply, turn.expect))
		await new Promise((r) => setTimeout(r, 800))
	}
	return all
}

const runCase = async (c: EvalCaseType): Promise<EvalCaseResultType> => {
	const runs = c.runs ?? 1
	const passRatio = c.passRatio ?? 1
	let runsPassed = 0
	let lastAssertions: EvalAssertionType[] = []
	for (let i = 0; i < runs; i++) {
		const assertions = await runCaseOnce(c)
		lastAssertions = assertions
		if (assertions.every((a) => a.ok)) runsPassed++
	}
	return {
		name: c.name,
		suite: c.suite,
		passed: runsPassed / runs >= passRatio,
		runsPassed,
		runs,
		assertions: lastAssertions,
	}
}

const main = async (): Promise<void> => {
	if (!(await waitForHealth())) {
		console.error("❌ node not reachable at EVAL_URL")
		process.exit(2)
	}
	const cases = loadCases()
	console.log(
		`▶ running ${cases.length} eval case(s)${LIVE ? " (LIVE)" : ""}\n`,
	)
	const results: EvalCaseResultType[] = []
	for (const c of cases) {
		const r = await runCase(c)
		results.push(r)
		const mark = r.passed ? "✅" : "❌"
		console.log(`${mark} [${r.suite}] ${r.name} (${r.runsPassed}/${r.runs})`)
		if (!r.passed)
			for (const a of r.assertions.filter((x) => !x.ok))
				console.log(`     ✗ ${a.name}${a.detail ? ` — ${a.detail}` : ""}`)
	}
	const passed = results.filter((r) => r.passed).length
	console.log(`\n${passed}/${results.length} cases passed`)
	process.exit(passed === results.length ? 0 : 1)
}

void main()

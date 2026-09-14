import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import {
	env,
	waitForHealth,
	postChat,
	postConfig,
	getConfig,
	resetConversation,
	pollRecord,
	assertTurn,
	evalCaseFileSchema,
	configSnapshot,
	execWrite,
	postConfigRefresh,
	probeRequirements,
	setupMockProviders,
	seedCaseFacts,
} from "./lib"
import type {
	EvalCaseType,
	EvalCaseResultType,
	EvalRunDetailType,
	EvalAssertionType,
	EvalRequirementType,
	EvalSuiteType,
	MockProvidersControlType,
} from "./types"

const CASES_DIR = join(process.cwd(), "evals", "cases")
const RESULTS_DIR = join(process.cwd(), "evals", "results")
const SUITES = env.EVAL_SUITES?.split(",").map((s) => s.trim())
const LIVE = env.EVAL_LIVE === "1"
const LABEL =
	env.LABEL ??
	`run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`

const EXCLUDED_SUITES: EvalSuiteType[] = [
	"conversation",
	"conversation-long",
	"tool-scenarios",
]

const loadCases = (): EvalCaseType[] => {
	const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json"))
	const cases: EvalCaseType[] = []
	for (const f of files) {
		let raw: unknown
		try {
			raw = JSON.parse(readFileSync(join(CASES_DIR, f), "utf8"))
		} catch (e) {
			console.error(`❌ invalid JSON in ${f}: ${(e as Error).message}`)
			process.exit(1)
		}
		const parsed = evalCaseFileSchema.safeParse(raw)
		if (!parsed.success) {
			console.error(`❌ invalid case file ${f}:`)
			for (const issue of parsed.error.issues)
				console.error(
					`   ${issue.path.join(".") || "(root)"}: ${issue.message}`,
				)
			process.exit(1)
		}
		cases.push(...parsed.data)
	}
	return cases.filter((c) => {
		if (EXCLUDED_SUITES.includes(c.suite)) return false
		if (c.suite === "home-live" && !LIVE) return false
		if (SUITES && !SUITES.includes(c.suite)) return false
		return true
	})
}

const SUITE_REQUIRES: Partial<Record<EvalSuiteType, EvalRequirementType[]>> = {
	"home-mock": ["skills"],
	"home-live": ["skills", "ha"],
	memory: ["facts"],
	tools: ["skills"],
	"tools-confirm": ["skills"],
	security: ["skills"],
	fast: ["skills"],
	routing: ["skills"],
}

const MOCK_SUITES: EvalSuiteType[] = [
	"home-mock",
	"tools",
	"tools-confirm",
	"security",
	"fast",
	"routing",
]

const withTools = !SUITES || SUITES.includes("tools")

const setupMockHa = (): Promise<MockProvidersControlType> =>
	setupMockProviders({ ha: true, music: withTools, plain: withTools })

const isolateFacts = async (): Promise<void> => {
	execWrite(
		"DELETE FROM memory_fact WHERE domia_id = (SELECT id FROM domia WHERE domia_key = ?)",
		[env.EVAL_DOMIA_KEY],
	)
	await postConfigRefresh()
}

const runCaseOnce = async (
	c: EvalCaseType,
): Promise<{ assertions: EvalAssertionType[]; interactionIds: string[] }> => {
	const assertions: EvalAssertionType[] = []
	const interactionIds: string[] = []
	for (const turn of c.turns) {
		const { interactionId, reply } = await postChat(turn.text, {
			satelliteId: turn.satelliteId,
		})
		interactionIds.push(interactionId)
		const needsTool = Boolean(
			turn.expect.tool || turn.expect.argsSubset || turn.expect.argMatchers,
		)
		const rec = await pollRecord(interactionId, needsTool)
		if (!rec) {
			assertions.push({
				name: `${turn.text} → record`,
				ok: false,
				detail: "no trace row",
			})
			continue
		}
		assertions.push(...assertTurn(rec, reply, turn.expect))
		await new Promise((r) => setTimeout(r, 800))
	}
	return { assertions, interactionIds }
}

const runCase = async (
	c: EvalCaseType,
	mockControl?: MockProvidersControlType,
): Promise<EvalCaseResultType> => {
	const runs = c.runs ?? 1
	const passRatio = c.passRatio ?? 1
	const runsDetail: EvalRunDetailType[] = []
	if (mockControl?.ha && c.mockHa) {
		await mockControl.ha.setBehavior(c.mockHa)
		if (c.mockHa.annotations || c.mockHa.catalogSize)
			await mockControl.ha.resync()
	}
	for (let i = 0; i < runs; i++) {
		if (c.isolate === "facts") await isolateFacts()
		if (MOCK_SUITES.includes(c.suite)) await resetConversation()
		await seedCaseFacts(c)
		const { assertions, interactionIds } = await runCaseOnce(c)
		runsDetail.push({
			run: i + 1,
			passed: assertions.every((a) => a.ok),
			interactionIds,
			assertions,
		})
	}
	if (mockControl?.ha && c.mockHa) {
		await mockControl.ha.setBehavior({})
		if (c.mockHa.annotations || c.mockHa.catalogSize)
			await mockControl.ha.resync()
	}
	const runsPassed = runsDetail.filter((r) => r.passed).length
	return {
		name: c.name,
		suite: c.suite,
		mode: c.mode ?? "gate",
		passed: runsPassed / runs >= passRatio,
		runsPassed,
		runs,
		runsDetail,
	}
}

const persistResults = (results: EvalCaseResultType[]): string => {
	mkdirSync(RESULTS_DIR, { recursive: true })
	const outFile = join(RESULTS_DIR, `${LABEL}.json`)
	writeFileSync(
		outFile,
		JSON.stringify(
			{
				label: LABEL,
				timestamp: new Date().toISOString(),
				snapshot: configSnapshot(),
				results,
			},
			null,
			"\t",
		),
	)
	return outFile
}

const main = async (): Promise<void> => {
	if (!(await waitForHealth())) {
		console.error("❌ node not reachable at EVAL_URL")
		process.exit(2)
	}
	const met = probeRequirements()
	const allCases = loadCases()
	const skipped = new Set<string>()
	const cases = allCases.filter((c) => {
		const needs = [...(SUITE_REQUIRES[c.suite] ?? [])]
		if (
			c.language === "es" &&
			(c.suite === "home-live" || MOCK_SUITES.includes(c.suite))
		)
			needs.push("multilingual")
		const missing = needs.filter((r) => !met.has(r))
		if (missing.length === 0) return true
		skipped.add(
			`[${c.suite}] ${c.language} — node lacks: ${missing.join(", ")}`,
		)
		return false
	})
	for (const note of skipped) console.log(`⏭️  SKIPPED ${note}`)
	console.log(
		`▶ running ${cases.length} eval case(s)${LIVE ? " (LIVE)" : ""}\n`,
	)
	const results: EvalCaseResultType[] = []
	const report = (r: EvalCaseResultType): void => {
		results.push(r)
		const mark = r.passed ? "✅" : r.mode === "advisory" ? "⚠️" : "❌"
		const advisory = r.mode === "advisory" ? " ADVISORY" : ""
		console.log(
			`${mark}${advisory} [${r.suite}] ${r.name} (${r.runsPassed}/${r.runs})`,
		)
		if (!r.passed) {
			const last = r.runsDetail[r.runsDetail.length - 1]
			for (const a of last.assertions.filter((x) => !x.ok))
				console.log(`     ✗ ${a.name}${a.detail ? ` — ${a.detail}` : ""}`)
		}
	}
	for (const c of cases.filter((c) => !MOCK_SUITES.includes(c.suite)))
		report(await runCase(c))
	const mockCases = cases.filter((c) => MOCK_SUITES.includes(c.suite))
	if (mockCases.length > 0) {
		const mock = await setupMockHa()
		try {
			for (const c of mockCases.filter((c) => c.suite !== "fast"))
				report(await runCase(c, mock))
			const fastCases = mockCases.filter((c) => c.suite === "fast")
			if (fastCases.length > 0) {
				const preConfig = await getConfig()
				const preFastPath = Boolean(
					(preConfig.llm as Record<string, unknown> | undefined)
						?.fastPathEnabled,
				)
				await postConfig({ llm: { fastPathEnabled: true } })
				try {
					for (const c of fastCases) report(await runCase(c, mock))
				} finally {
					await postConfig({ llm: { fastPathEnabled: preFastPath } })
				}
			}
		} finally {
			await mock.teardown()
		}
	}
	const gateResults = results.filter((r) => r.mode === "gate")
	const gatePassed = gateResults.filter((r) => r.passed).length
	const passed = results.filter((r) => r.passed).length
	console.log(
		`\n${passed}/${results.length} cases passed (gate: ${gatePassed}/${gateResults.length})`,
	)
	if (skipped.size > 0) console.log(`⏭️  skipped: ${[...skipped].join(" · ")}`)
	const outFile = persistResults(results)
	console.log(`saved → ${outFile}`)
	process.exit(gatePassed === gateResults.length ? 0 : 1)
}

void main()

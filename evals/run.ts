import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import {
	env,
	waitForHealth,
	postChat,
	postModules,
	postConfig,
	resetConversation,
	pollRecord,
	assertTurn,
	evalCaseFileSchema,
	configSnapshot,
	execWrite,
	postConfigRefresh,
	probeRequirements,
	startMockHa,
	queryOne,
	queryAll,
	sleep,
	MOCK_HA_PROVIDER_ID,
} from "./lib"
import type {
	EvalCaseType,
	EvalCaseResultType,
	EvalRunDetailType,
	EvalAssertionType,
	EvalRequirementType,
	EvalSuiteType,
} from "./types"

const CASES_DIR = join(process.cwd(), "evals", "cases")
const RESULTS_DIR = join(process.cwd(), "evals", "results")
const SUITES = env.EVAL_SUITES?.split(",").map((s) => s.trim())
const LIVE = env.EVAL_LIVE === "1"
const LABEL =
	env.LABEL ??
	`run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`

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
		if (c.suite === "conversation") return false
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

const reloadSkills = async (): Promise<void> => {
	await postModules({ skillsEngine: false })
	await sleep(500)
	await postModules({ skillsEngine: true })
}

const waitForMockSync = async (): Promise<boolean> => {
	const start = Date.now()
	while (Date.now() - start < 15000) {
		const row = queryOne<{ v: string | null }>(
			"SELECT tools_cache AS v FROM skill_provider WHERE id = ?",
			[MOCK_HA_PROVIDER_ID],
		)
		if (row?.v && row.v.includes("HassTurnOn")) return true
		await sleep(500)
	}
	return false
}

const setupMockHa = async (): Promise<{
	teardown: () => Promise<void>
	setBehavior: (patch: Record<string, unknown>) => Promise<void>
	resync: () => Promise<void>
}> => {
	const mock = await startMockHa()
	const realProviders = queryAll<{ id: string }>(
		"SELECT id FROM skill_provider WHERE is_active = 1 AND id != ?",
		[MOCK_HA_PROVIDER_ID],
	)
	for (const p of realProviders)
		execWrite("UPDATE skill_provider SET is_active = 0 WHERE id = ?", [p.id])
	execWrite(
		`INSERT OR REPLACE INTO skill_provider
		 (id, name, is_active, domia_id, protocol, type, url, descriptor, priority)
		 VALUES (?, 'home-assistant', 1,
		   (SELECT id FROM domia WHERE domia_key = ?), 'mcp', 'http', ?,
		   '{"version": 1, "kind": "home-assistant"}', 0)`,
		[MOCK_HA_PROVIDER_ID, env.EVAL_DOMIA_KEY, mock.url],
	)
	await reloadSkills()
	const synced = await waitForMockSync()
	if (!synced) console.warn("⚠️ mock-ha provider did not sync tools in time")
	return {
		teardown: async () => {
			execWrite("DELETE FROM skill_provider WHERE id = ?", [
				MOCK_HA_PROVIDER_ID,
			])
			for (const p of realProviders)
				execWrite("UPDATE skill_provider SET is_active = 1 WHERE id = ?", [
					p.id,
				])
			await reloadSkills()
			await mock.close()
		},
		setBehavior: mock.setBehavior,
		resync: async () => {
			await reloadSkills()
			await waitForMockSync()
		},
	}
}

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
		const { interactionId, reply } = await postChat(turn.text)
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
	mockControl?: {
		setBehavior: (patch: Record<string, unknown>) => Promise<void>
		resync: () => Promise<void>
	},
): Promise<EvalCaseResultType> => {
	const runs = c.runs ?? 1
	const passRatio = c.passRatio ?? 1
	const runsDetail: EvalRunDetailType[] = []
	if (mockControl && c.mockHa) {
		await mockControl.setBehavior(c.mockHa)
		if (c.mockHa.annotations || c.mockHa.catalogSize) await mockControl.resync()
	}
	for (let i = 0; i < runs; i++) {
		if (c.isolate === "facts") await isolateFacts()
		if (MOCK_SUITES.includes(c.suite)) await resetConversation()
		const { assertions, interactionIds } = await runCaseOnce(c)
		runsDetail.push({
			run: i + 1,
			passed: assertions.every((a) => a.ok),
			interactionIds,
			assertions,
		})
	}
	if (mockControl && c.mockHa) {
		await mockControl.setBehavior({})
		if (c.mockHa.annotations || c.mockHa.catalogSize) await mockControl.resync()
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
				await postConfig({ llm: { fastPathEnabled: true } })
				try {
					for (const c of fastCases) report(await runCase(c, mock))
				} finally {
					await postConfig({ llm: { fastPathEnabled: false } })
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

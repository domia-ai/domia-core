import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { DEFAULT_MEMORY_WINDOW_TURNS } from "@/db"
import { toolBaseName } from "@/modules/skill-engine"

import {
	aliasEntities,
	assertCoherence,
	assertTurn,
	configSnapshot,
	conversationMetrics,
	evalCaseFileSchema,
	executedTools,
	getConfig,
	isolateConversation,
	judgeConversation,
	judgeReply,
	loadSiteMap,
	pollRecord,
	postChat,
	postConfig,
	seedCaseFacts,
	setupMockProviders,
	sleep,
	substituteTurn,
	turnPlaceholdersLeft,
	waitForHealth,
} from "./lib"
import { env } from "./lib/env"
import type {
	ConversationGateType,
	ConversationJudgeVerdictType,
	ConversationLatencyType,
	ConversationMetricsType,
	ConversationTurnResultType,
	EvalAssertionType,
	EvalCaseType,
	EvalOnReplyWhenType,
	EvalTurnRecordType,
	EvalTurnType,
	MockProvidersControlType,
	SiteEntityType,
} from "./types"

const CASES_DIR = join(process.cwd(), "evals", "cases")
const RESULTS_DIR = join(process.cwd(), "evals", "bench-results")
const SETTLE_MS = 700
const ANAPHOR_RE = /\b(it|them|they|that|those|these|again|same|too|as well)\b/i
const LABEL =
	env.LABEL ??
	`conv30-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`

const loadCases = (): EvalCaseType[] => {
	const cases: EvalCaseType[] = []
	for (const file of readdirSync(CASES_DIR).filter((f) =>
		f.endsWith(".json"),
	)) {
		const parsed = evalCaseFileSchema.safeParse(
			JSON.parse(readFileSync(join(CASES_DIR, file), "utf8")) as unknown,
		)
		if (!parsed.success) {
			console.error(`❌ invalid case file ${file}:`)
			for (const issue of parsed.error.issues)
				console.error(
					`   ${issue.path.join(".") || "(root)"}: ${issue.message}`,
				)
			process.exit(1)
		}
		cases.push(...parsed.data)
	}
	return cases.filter((c) => c.suite === "conversation-long")
}

const entityWordsOf = (entities: Record<string, SiteEntityType>): string[] =>
	Object.values(entities).flatMap((e) =>
		[e.name, e.spoken, e.spokenSingular, e.token, e.area]
			.filter((v): v is string => typeof v === "string")
			.map((v) => v.toLowerCase()),
	)

const resolveTurns = (
	evalCase: EvalCaseType,
	entities: Record<string, SiteEntityType>,
	siteName: string,
): { turns: EvalTurnType[]; skipped: string[] } => {
	const turns: EvalTurnType[] = []
	const skipped: string[] = []
	for (const raw of evalCase.turns) {
		const turn = substituteTurn(raw, entities)
		const left = turnPlaceholdersLeft(turn)
		if (left.length > 0) {
			skipped.push(
				`${raw.id ?? raw.name ?? raw.text} — site "${siteName}" lacks ${left.join(", ")}`,
			)
			continue
		}
		turns.push(turn)
	}
	return { turns, skipped }
}

const routedOf = (rec: EvalTurnRecordType | null): string => {
	const intent = rec?.intentDecision ?? ""
	if (intent.startsWith("fast-path")) return "fast"
	return (rec?.toolCallCount ?? 0) > 0 || /skill/i.test(intent)
		? "skill"
		: "chat"
}

const statusOfTool = (
	rec: EvalTurnRecordType | null,
	tool: string,
): string[] => {
	const entries = (rec?.skillResponse ?? []).filter(
		(e): e is { tool?: string; kind?: string; status?: string } =>
			e !== null && typeof e === "object" && "tool" in e,
	)
	return entries
		.filter(
			(e) =>
				(e.kind === "result" || e.kind === "async_outcome") &&
				toolBaseName(e.tool ?? "") === tool,
		)
		.map((e) => e.status ?? "")
}

const whenMatches = (
	when: EvalOnReplyWhenType,
	rec: EvalTurnRecordType | null,
	reply: string,
	tools: string[],
): boolean => {
	if (when.toolCalled && !tools.includes(when.toolCalled)) return false
	if (when.notToolCalled && tools.includes(when.notToolCalled)) return false
	if (when.replyMatches && !new RegExp(when.replyMatches, "i").test(reply))
		return false
	if (when.routed && routedOf(rec) !== when.routed) return false
	if (when.traceToolStatus)
		for (const [tool, status] of Object.entries(when.traceToolStatus))
			if (!statusOfTool(rec, tool).includes(status)) return false
	return true
}

const applyBehavior = async (
	mock: MockProvidersControlType | null,
	patch: EvalCaseType["mockHa"],
): Promise<void> => {
	if (!mock?.ha) return
	const { stateful, ...rest } = patch ?? {}
	if (stateful === false)
		throw new Error(
			"the eval mock HA is stateful — mockHa.stateful:false is unsupported",
		)
	await mock.ha.setBehavior(rest)
}

const runTurn = async (
	turn: EvalTurnType,
	priorReplies: string[],
	anaphora: boolean,
	step: number,
): Promise<ConversationTurnResultType> => {
	const { interactionId, reply } = await postChat(turn.text)
	const needsTool = Boolean(
		turn.expect.tool ||
		turn.expect.tools ||
		turn.expect.argsSubset ||
		turn.expect.argMatchers,
	)
	const rec = await pollRecord(interactionId, needsTool)
	const assertions: EvalAssertionType[] = []
	if (!rec) {
		assertions.push({ name: "record", ok: false, detail: "no trace row" })
	} else {
		assertions.push(...assertTurn(rec, reply, turn.expect))
		assertions.push(
			...assertCoherence(reply, turn.text, priorReplies, turn.expect),
		)
		if (turn.expect.judge) {
			const verdict = await judgeReply(
				turn.text,
				reply,
				turn.expect.judge.rubric,
			)
			assertions.push({
				name: `judge>=${turn.expect.judge.min}`,
				ok: verdict.score >= turn.expect.judge.min,
				detail: `score ${verdict.score} — ${verdict.reason}`,
			})
		}
	}
	return {
		step,
		id: turn.id ?? turn.name ?? turn.text,
		name: turn.name ?? turn.text,
		user: turn.text,
		reply,
		passed: assertions.every((a) => a.ok),
		anaphora,
		tools: rec ? executedTools(rec) : [],
		intent: rec?.intentDecision ?? null,
		assertions,
		record: rec,
		nextId: null,
	}
}

const walk = async (
	evalCase: EvalCaseType,
	turns: EvalTurnType[],
	entityWords: string[],
	mock: MockProvidersControlType | null,
): Promise<{ results: ConversationTurnResultType[]; unvisited: string[] }> => {
	const idAt = new Map<string, number>()
	turns.forEach((t, i) => {
		if (t.id) idAt.set(t.id, i)
	})
	const results: ConversationTurnResultType[] = []
	const visited = new Set<number>()
	const maxSteps = turns.length * 2
	let index = 0
	let step = 0
	while (index >= 0 && index < turns.length && step < maxSteps) {
		const turn = turns[index]
		visited.add(index)
		step++
		if (turn.mockHa) await applyBehavior(mock, turn.mockHa)
		const anaphora =
			Boolean(turn.expect.tools ?? turn.expect.tool) &&
			ANAPHOR_RE.test(turn.text) &&
			!entityWords.some((w) => turn.text.toLowerCase().includes(w))
		const result = await runTurn(
			turn,
			results.map((r) => r.reply),
			anaphora,
			step,
		)
		if (turn.mockHa) await applyBehavior(mock, evalCase.mockHa)
		const jump = (turn.onReply ?? []).find((rule) =>
			whenMatches(rule.when, result.record, result.reply, result.tools),
		)
		const target = jump ? idAt.get(jump.next) : undefined
		result.nextId = jump?.next ?? null
		results.push(result)
		console.log(
			`${result.passed ? "✅" : "❌"} ${step}. ${result.id} · ${routedOf(result.record)}${result.tools.length ? `(${result.tools.join(",")})` : ""} → "${result.reply.slice(0, 70)}"`,
		)
		for (const a of result.assertions.filter((x) => !x.ok))
			console.log(`     ✗ ${a.name}${a.detail ? ` — ${a.detail}` : ""}`)
		if (jump && target === undefined)
			console.log(`     ⏭️  branch target "${jump.next}" is not in this site`)
		if (turn.end) break
		index = target ?? index + 1
		await sleep(SETTLE_MS)
	}
	const unvisited = turns
		.filter((_, i) => !visited.has(i))
		.map((t) => t.id ?? t.name ?? t.text)
	return { results, unvisited }
}

const gatesOf = (
	evalCase: EvalCaseType,
	metrics: ConversationMetricsType,
	judge: ConversationJudgeVerdictType | null,
): ConversationGateType[] => {
	const t = evalCase.conversation
	if (!t) return []
	const gates: ConversationGateType[] = []
	const atLeast = (
		name: string,
		value: number | null,
		min: number | undefined,
	): void => {
		if (min === undefined) return
		gates.push({
			name: `${name}>=${min}`,
			ok: value !== null && value >= min,
			detail: value === null ? "not measured" : value.toFixed(3),
		})
	}
	const atMost = (
		name: string,
		latency: ConversationLatencyType,
		max: number | undefined,
	): void => {
		if (max === undefined) return
		gates.push({
			name: `${name}<=${max}ms`,
			ok: latency.p50 === null || latency.p50 <= max,
			detail:
				latency.p50 === null
					? "not measured — no samples on this transport"
					: `${latency.p50}ms (n=${latency.n})`,
		})
	}
	atLeast("turnPassRate", metrics.turnPassRate, t.minTurnPassRate)
	atLeast("toolCorrectness", metrics.toolCorrectness, t.minToolCorrectness)
	atLeast(
		"instructionFollowing",
		metrics.instructionFollowing,
		t.minInstructionFollowing,
	)
	atLeast("contextRetention", metrics.contextRetention, t.minContextRetention)
	atMost("ttftP50", metrics.ttftMs, t.ttftP50MaxMs)
	atMost("ttfaP50", metrics.ttfaMs, t.ttfaP50MaxMs)
	atMost("perceivedTtfaP50", metrics.perceivedTtfaMs, t.perceivedTtfaP50MaxMs)
	if (t.judge)
		gates.push({
			name: `judge>=${t.judge.min}`,
			ok: (judge?.score ?? 0) >= t.judge.min,
			detail: judge
				? `median ${judge.score} · agreement ${judge.agreement.toFixed(2)} · panel ${judge.panel.map((m) => `${m.judge}=${m.score}`).join(" ")} — ${judge.reason}`
				: "not judged",
		})
	return gates
}

const renderTranscript = (
	evalCase: EvalCaseType,
	siteName: string,
	results: ConversationTurnResultType[],
	skipped: string[],
	metrics: ConversationMetricsType,
	judge: ConversationJudgeVerdictType | null,
	gates: ConversationGateType[],
): string => {
	const lines = [
		`# ${evalCase.name} — ${LABEL}`,
		"",
		`site: ${siteName} · node: ${env.EVAL_URL} · identity: ${env.EVAL_DOMIA_KEY}`,
		"",
		"## Gates",
		"",
		...gates.map((g) => `- ${g.ok ? "✅" : "❌"} ${g.name} — ${g.detail}`),
		"",
		"## Metrics",
		"",
		"```json",
		JSON.stringify(metrics, null, 2),
		"```",
		"",
	]
	if (judge)
		lines.push(
			"## Judge",
			"",
			`median ${judge.score} · agreement ${judge.agreement.toFixed(2)} — ${judge.reason}`,
			"",
			"| judge | score | positions | reason |",
			"| --- | --- | --- | --- |",
			...judge.panel.map(
				(m) =>
					`| ${m.judge} | ${m.score} | ${m.positionScores.join(" / ")} | ${m.reason} |`,
			),
			"",
			...judge.issues.map((i) => `- ${i}`),
			"",
		)
	if (skipped.length)
		lines.push("## Skipped", "", ...skipped.map((s) => `- ${s}`), "")
	lines.push("## Transcript", "")
	for (const r of results) {
		lines.push(
			`### ${r.step}. ${r.id}${r.anaphora ? " · anaphora" : ""} · ${routedOf(r.record)}${r.tools.length ? `(${r.tools.join(",")})` : ""}${r.nextId ? ` → ${r.nextId}` : ""}`,
		)
		lines.push(`- **User:** ${r.user}`)
		lines.push(`- **Domia:** ${r.reply}`)
		for (const a of r.assertions)
			lines.push(
				`  - ${a.ok ? "✅" : "❌"} ${a.name}${a.ok ? "" : ` — ${a.detail ?? ""}`}`,
			)
		lines.push("")
	}
	return lines.join("\n")
}

const withRunConfig = async <T>(run: () => Promise<T>): Promise<T> => {
	const config = await getConfig()
	const modules = (config.modules ?? {}) as Record<string, unknown>
	const domia = (config.domia ?? {}) as Record<string, unknown>
	const priorSkills = modules.skillsEngine === true
	const priorWindow = Number(domia.memoryWindowTurns ?? 0)
	const patch: Record<string, unknown> = {}
	if (!priorSkills) patch.modules = { skillsEngine: true }
	if (priorWindow < 1) {
		patch.domia = { memoryWindowTurns: DEFAULT_MEMORY_WINDOW_TURNS }
		console.log(
			`⚠️ memoryWindowTurns is ${priorWindow} on ${env.EVAL_DOMIA_KEY} — raising it to ${DEFAULT_MEMORY_WINDOW_TURNS} for this run`,
		)
	}
	if (Object.keys(patch).length > 0) await postConfig(patch)
	try {
		return await run()
	} finally {
		const restore: Record<string, unknown> = {}
		if (!priorSkills) restore.modules = { skillsEngine: priorSkills }
		if (priorWindow < 1) restore.domia = { memoryWindowTurns: priorWindow }
		if (Object.keys(restore).length > 0)
			await postConfig(restore).catch(() => undefined)
	}
}

const runCase = async (evalCase: EvalCaseType): Promise<boolean> => {
	const siteName = process.env.EVAL_HA_SITE ?? evalCase.site ?? env.EVAL_HA_SITE
	const site = loadSiteMap(siteName)
	const entities = aliasEntities(site, evalCase.entities)
	const { turns, skipped } = resolveTurns(evalCase, entities, siteName)
	for (const note of skipped) console.log(`⏭️  SKIPPED ${note}`)
	if (siteName !== "mock" && env.EVAL_LIVE !== "1") {
		console.error(
			`❌ site "${siteName}" actuates real devices — set EVAL_LIVE=1 to run it`,
		)
		process.exit(2)
	}
	const mock =
		siteName === "mock" ? await setupMockProviders({ ha: true }) : null
	let walked: { results: ConversationTurnResultType[]; unvisited: string[] }
	try {
		await applyBehavior(mock, evalCase.mockHa)
		await isolateConversation()
		await seedCaseFacts(evalCase)
		walked = await walk(evalCase, turns, entityWordsOf(entities), mock)
	} finally {
		await mock?.teardown()
	}
	const { results, unvisited } = walked
	const metrics = conversationMetrics(results)
	const rubric = evalCase.conversation?.judge?.rubric
	const judge = rubric
		? await judgeConversation(
				results.map((r) => ({ user: r.user, reply: r.reply })),
				rubric,
			)
		: null
	const gates = gatesOf(evalCase, metrics, judge)
	const notRun = [
		...skipped,
		...unvisited.map((id) => `${id} — branch skipped`),
	]
	mkdirSync(RESULTS_DIR, { recursive: true })
	const slug = evalCase.name.replace(/\W+/g, "-").toLowerCase()
	const jsonPath = join(RESULTS_DIR, `conversation-long-${slug}-${LABEL}.json`)
	writeFileSync(
		jsonPath,
		JSON.stringify(
			{
				label: LABEL,
				case: evalCase.name,
				site: siteName,
				url: env.EVAL_URL,
				domiaKey: env.EVAL_DOMIA_KEY,
				capturedAt: new Date().toISOString(),
				snapshot: configSnapshot(),
				metrics,
				judge,
				gates,
				notRun,
				turns: results.map((r) => ({
					step: r.step,
					id: r.id,
					user: r.user,
					reply: r.reply,
					routed: routedOf(r.record),
					tools: r.tools,
					intent: r.intent,
					anaphora: r.anaphora,
					passed: r.passed,
					nextId: r.nextId,
					assertions: r.assertions,
					llmTtftMs: r.record?.llmTtftMs ?? null,
					ttfaMs: r.record?.ttfaMs ?? null,
					perceivedTtfaMs: r.record?.perceivedTtfaMs ?? null,
					llmFirstSentenceMs: r.record?.llmFirstSentenceMs ?? null,
					eouDelayMs: r.record?.eouDelayMs ?? null,
					endpointDebounceMs: r.record?.endpointDebounceMs ?? null,
					implicitFeedback: r.record?.implicitFeedback ?? null,
					heardReply: r.record?.heardReply ?? null,
				})),
			},
			null,
			2,
		),
	)
	const mdPath = join(RESULTS_DIR, `conversation-long-${slug}-${LABEL}.md`)
	writeFileSync(
		mdPath,
		renderTranscript(
			evalCase,
			siteName,
			results,
			notRun,
			metrics,
			judge,
			gates,
		),
	)
	console.log(`\n=== ${evalCase.name} (${siteName}) ===`)
	for (const g of gates)
		console.log(`${g.ok ? "✅" : "❌"} ${g.name} — ${g.detail}`)
	console.log(
		`turns ${results.filter((r) => r.passed).length}/${results.length} · notRun ${notRun.length}`,
	)
	console.log(`transcript → ${mdPath}`)
	console.log(`summary    → ${jsonPath}`)
	return gates.every((g) => g.ok)
}

const main = async (): Promise<void> => {
	if (!(await waitForHealth())) {
		console.error("❌ node not reachable at EVAL_URL")
		process.exit(2)
	}
	let cases = loadCases()
	if (env.EVAL_CASE_FILTER)
		cases = cases.filter((c) => c.name.includes(env.EVAL_CASE_FILTER ?? ""))
	if (cases.length === 0) {
		console.error('no cases with suite "conversation-long" found')
		process.exit(1)
	}
	const passed = await withRunConfig(async () => {
		const verdicts: boolean[] = []
		for (const c of cases) verdicts.push(await runCase(c))
		return verdicts
	})
	const ok = passed.filter(Boolean).length
	console.log(`\n${ok}/${cases.length} long conversations passed every gate`)
	process.exit(ok === cases.length ? 0 : 1)
}

void main()

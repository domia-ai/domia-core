import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { env } from "./lib/env"
import { meshHeaders, sleep } from "./lib/http"
import { queryOne } from "./lib/db"
import {
	aliasEntities,
	CONFIRM_RE,
	evalCaseFileSchema,
	loadSiteMap,
	makeChecker,
	READ_TOOL_RE,
	setupMockProviders,
	stringOrEmpty,
	substituteTurn,
	turnPlaceholdersLeft,
} from "./lib"
import type {
	EvalCaseType,
	EvalTurnType,
	MockMusicStateType,
	MockProvidersControlType,
	ToolScenarioResultType,
	ToolScenarioRowType,
	ToolScenarioToolEntryType,
} from "./types"

const SETTLE_MS = 600
const CASE_FILE = join(process.cwd(), "evals", "cases", env.EVAL_SCENARIO_FILE)

const checker = makeChecker()
const labelIdx = process.argv.indexOf("--label")
const label =
	labelIdx >= 0
		? process.argv[labelIdx + 1]
		: env.EVAL_SCENARIO_FILE.replace(/\.json$/, "")

const loadCase = (): EvalCaseType => {
	const parsed = evalCaseFileSchema.safeParse(
		JSON.parse(readFileSync(CASE_FILE, "utf8")) as unknown,
	)
	if (!parsed.success) {
		console.error(`❌ invalid case file ${CASE_FILE}:`)
		for (const issue of parsed.error.issues)
			console.error(`   ${issue.path.join(".") || "(root)"}: ${issue.message}`)
		process.exit(1)
	}
	const found = parsed.data.find((c) => c.suite === "tool-scenarios")
	if (!found) {
		console.error(`❌ no tool-scenarios case in ${CASE_FILE}`)
		process.exit(1)
	}
	return found
}

const postChat = async (
	text: string,
	satelliteId?: string,
): Promise<{ interactionId: string; reply: string; totalMs: number }> => {
	const res = await fetch(
		`${env.EVAL_URL}/chat?domiaKey=${env.EVAL_DOMIA_KEY}`,
		{
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify({ text, ...(satelliteId ? { satelliteId } : {}) }),
		},
	)
	const body = (await res.json()) as {
		interactionId: string
		reply: string
		timings?: { totalMs?: number }
	}
	return {
		interactionId: body.interactionId,
		reply: body.reply,
		totalMs: body.timings?.totalMs ?? 0,
	}
}

const readRow = async (
	interactionId: string,
): Promise<ToolScenarioRowType | null> => {
	const start = Date.now()
	while (Date.now() - start < env.EVAL_POLL_TIMEOUT_MS) {
		const row = queryOne<ToolScenarioRowType>(
			"SELECT intent_decision, tool_call_count, skill_response, llm_response, status, llm_ms, total_ms FROM interaction_trace WHERE id = ?",
			[interactionId],
		)
		if (row && (row.status === "ok" || row.status === "failed")) {
			await sleep(SETTLE_MS)
			return (
				queryOne<ToolScenarioRowType>(
					"SELECT intent_decision, tool_call_count, skill_response, llm_response, status, llm_ms, total_ms FROM interaction_trace WHERE id = ?",
					[interactionId],
				) ?? row
			)
		}
		await sleep(200)
	}
	return null
}

const resultEntries = (
	row: ToolScenarioRowType | null,
): ToolScenarioToolEntryType[] => {
	if (!row?.skill_response) return []
	try {
		const entries = JSON.parse(
			row.skill_response,
		) as ToolScenarioToolEntryType[]
		return entries.filter((e) => e.kind === "result" && e.tool)
	} catch {
		return []
	}
}

const namespacedToolsOf = (row: ToolScenarioRowType | null): string[] =>
	resultEntries(row).map((e) => String(e.tool))

const toolsOf = (row: ToolScenarioRowType | null): string[] =>
	namespacedToolsOf(row).map((tool) => tool.split("__").pop() ?? "")

const calledArgs = (
	row: ToolScenarioRowType | null,
): Record<string, unknown>[] =>
	resultEntries(row).map((e) => e.resolvedArgs ?? e.args ?? {})

const playerState = (
	state: MockMusicStateType | null,
	playerId: string,
): MockMusicStateType["players"][number] | undefined =>
	state?.players.find((p) => p.player_id === playerId)

const evaluate = (
	namespacedChecks: boolean,
	turn: EvalTurnType,
	reply: string,
	row: ToolScenarioRowType | null,
	musicState: MockMusicStateType | null,
): { pass: boolean; detail: string } => {
	const tools = toolsOf(row)
	const intent = row?.intent_decision ?? ""
	const reasons: string[] = []
	const e = turn.expect
	const replyMatches = e.replyMatches ? new RegExp(e.replyMatches, "i") : null
	const replyNotMatches = e.replyNotMatches
		? new RegExp(e.replyNotMatches, "i")
		: null
	if (e.tools && tools.join(",") !== e.tools.join(","))
		reasons.push(
			`tools=${tools.join(",") || "none"} expected=${e.tools.join(",")}`,
		)
	if (e.toolsNamespaced && namespacedChecks) {
		const namespaced = namespacedToolsOf(row)
		if (namespaced.join(",") !== e.toolsNamespaced.join(","))
			reasons.push(
				`namespaced=${namespaced.join(",") || "none"} expected=${e.toolsNamespaced.join(",")}`,
			)
	}
	for (const required of e.tool ? [e.tool].flat() : [])
		if (!tools.includes(required))
			reasons.push(`tools=${tools.join(",") || "none"} lacks ${required}`)
	for (const forbidden of e.notTools ?? [])
		if (tools.includes(forbidden))
			reasons.push(`tools=${tools.join(",")} includes ${forbidden}`)
	if (e.argsSubset) {
		const all = calledArgs(row)
		const hit = all.some((args) =>
			Object.entries(e.argsSubset ?? {}).every(
				([key, value]) =>
					stringOrEmpty(args[key]).toLowerCase() ===
					stringOrEmpty(value).toLowerCase(),
			),
		)
		if (!hit)
			reasons.push(
				`args=${JSON.stringify(all)} lacks ${JSON.stringify(e.argsSubset)}`,
			)
	}
	if (e.anyArgMatches) {
		const re = new RegExp(e.anyArgMatches, "i")
		const all = calledArgs(row)
		if (!all.some((args) => re.test(JSON.stringify(args))))
			reasons.push(`args=${JSON.stringify(all)} lacks ${e.anyArgMatches}`)
	}
	if (e.mockMusicState && musicState) {
		const want = e.mockMusicState
		const player = playerState(musicState, want.player)
		if (!player) reasons.push(`mock has no player ${want.player}`)
		else {
			if (want.state && player.state !== want.state)
				reasons.push(
					`${want.player}.state=${player.state} expected=${want.state}`,
				)
			if (
				want.volumeLevel !== undefined &&
				player.volume_level !== want.volumeLevel
			)
				reasons.push(
					`${want.player}.volume=${player.volume_level} expected=${want.volumeLevel}`,
				)
			if (want.muted !== undefined && player.volume_muted !== want.muted)
				reasons.push(
					`${want.player}.muted=${player.volume_muted} expected=${want.muted}`,
				)
			if (
				want.currentItemMatches &&
				!new RegExp(want.currentItemMatches, "i").test(
					player.current_item?.name ?? "",
				)
			)
				reasons.push(
					`${want.player}.current_item=${player.current_item?.name ?? "none"} lacks ${want.currentItemMatches}`,
				)
		}
	}
	if (e.noTools && tools.length > 0)
		reasons.push(`unexpected tools=${tools.join(",")}`)
	if (e.noWrites && tools.some((t) => !READ_TOOL_RE.test(t)))
		reasons.push(`write executed: ${tools.join(",")}`)
	if (e.fastPath && !intent.startsWith("fast-path:"))
		reasons.push(`intent=${intent || "none"} (expected fast-path)`)
	if (e.compound && !intent.startsWith(`fast-path:compound(${e.compound})`))
		reasons.push(
			`intent=${intent || "none"} (expected compound(${e.compound}))`,
		)
	if (e.replyNotQuestion && CONFIRM_RE.test(reply))
		reasons.push("reply asked for confirmation")
	if (replyMatches && !replyMatches.test(reply))
		reasons.push(`reply lacks ${String(replyMatches)}`)
	if (replyNotMatches?.test(reply))
		reasons.push(`reply contradicts ${String(replyNotMatches)}`)
	if (reply.trim().length === 0) reasons.push("empty reply")
	if (reply.trim().startsWith("{")) reasons.push("reply is JSON")
	return { pass: reasons.length === 0, detail: reasons.join("; ") }
}

const resolveTurns = (
	evalCase: EvalCaseType,
	siteName: string,
): { turns: EvalTurnType[]; skipped: string[] } => {
	const site = loadSiteMap(siteName)
	const entities = aliasEntities(site, evalCase.entities)
	const turns: EvalTurnType[] = []
	const skipped: string[] = []
	for (const raw of evalCase.turns) {
		const turn = substituteTurn(raw, entities, site.speakers)
		const left = turnPlaceholdersLeft(turn)
		if (left.length > 0) {
			skipped.push(
				`${raw.name ?? raw.text} — site "${siteName}" lacks ${left.join(", ")}`,
			)
			continue
		}
		turns.push(turn)
	}
	return { turns, skipped }
}

const siteOf = (evalCase: EvalCaseType): string => {
	if (evalCase.mockMusic)
		return process.env.EVAL_MUSIC_SITE ?? evalCase.site ?? env.EVAL_MUSIC_SITE
	return process.env.EVAL_HA_SITE ?? evalCase.site ?? env.EVAL_HA_SITE
}

const applyMusicBehavior = async (
	mock: MockProvidersControlType | null,
	patch: EvalCaseType["mockMusic"],
): Promise<void> => {
	if (!mock?.music || !patch) return
	const { stateful, ...rest } = patch
	if (stateful === false)
		throw new Error(
			"the eval mock music server is stateful — mockMusic.stateful:false is unsupported",
		)
	if (Object.keys(rest).length > 0) await mock.music.setBehavior(rest)
}

const main = async (): Promise<void> => {
	const evalCase = loadCase()
	const siteName = siteOf(evalCase)
	const { turns, skipped } = resolveTurns(evalCase, siteName)
	for (const note of skipped) console.log(`⏭️  SKIPPED ${note}`)
	console.log(`▶ site ${siteName} · ${turns.length} scenario(s)\n`)
	const mock: MockProvidersControlType | null =
		siteName === "mock"
			? await setupMockProviders({
					ha: true,
					music: Boolean(evalCase.mockMusic),
				})
			: null
	await applyMusicBehavior(mock, evalCase.mockMusic)
	const stateAssertions = turns.filter((t) => t.expect.mockMusicState).length
	if (stateAssertions > 0 && !mock?.music)
		console.log(
			`⏭️  ${stateAssertions} mock-state assertion(s) skipped — site ${siteName} runs no mock music server`,
		)
	const results: ToolScenarioResultType[] = []
	try {
		for (const turn of turns) {
			const { interactionId, reply, totalMs } = await postChat(
				turn.text,
				turn.satelliteId,
			)
			const row = await readRow(interactionId)
			const musicState = turn.expect.mockMusicState
				? ((await mock?.music?.state()) ?? null)
				: null
			const verdict = evaluate(
				siteName === "mock",
				turn,
				reply,
				row,
				musicState,
			)
			const gate = turn.gate === true
			results.push({
				name: turn.name ?? turn.text,
				text: turn.text,
				gate,
				pass: verdict.pass,
				detail: verdict.detail,
				reply,
				tools: toolsOf(row),
				intent: row?.intent_decision ?? null,
				totalMs: row?.total_ms ?? totalMs,
			})
			checker.check(
				`[${gate ? "gate" : "score"}] ${turn.name ?? turn.text} → "${reply.slice(0, 60)}" (${totalMs}ms)`,
				verdict.pass || !gate,
				verdict.detail,
			)
			if (!gate && !verdict.pass)
				console.log(`  ↳ score miss: ${verdict.detail}`)
			await sleep(env.EVAL_TURN_GAP_MS)
		}
	} finally {
		await mock?.teardown()
	}
	const gates = results.filter((r) => r.gate)
	const scores = results.filter((r) => !r.gate)
	const summary = {
		label,
		site: siteName,
		url: env.EVAL_URL,
		domiaKey: env.EVAL_DOMIA_KEY,
		capturedAt: new Date().toISOString(),
		gatePass: gates.filter((r) => r.pass).length,
		gateTotal: gates.length,
		scorePass: scores.filter((r) => r.pass).length,
		scoreTotal: scores.length,
		skipped,
		medianTotalMs: [...results]
			.map((r) => r.totalMs ?? 0)
			.sort((a, b) => a - b)[Math.floor(results.length / 2)],
		results,
	}
	const dir = join(process.cwd(), "evals", "bench-results")
	mkdirSync(dir, { recursive: true })
	writeFileSync(
		join(dir, `tool-scenarios-${label}.json`),
		JSON.stringify(summary, null, 2),
	)
	console.log(
		`\n${label} (${siteName}): gates ${summary.gatePass}/${summary.gateTotal} · score ${summary.scorePass}/${summary.scoreTotal} · median ${summary.medianTotalMs}ms → evals/bench-results/tool-scenarios-${label}.json`,
	)
	process.exit(summary.gatePass === summary.gateTotal ? 0 : 1)
}

void main()

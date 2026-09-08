import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { env } from "./lib/env"
import { meshHeaders, sleep } from "./lib/http"
import { queryOne } from "./lib/db"
import { makeChecker } from "./lib"

type ScenarioExpectType = {
	tools?: string[]
	noTools?: boolean
	noWrites?: boolean
	fastPath?: boolean
	compound?: number
	replyNotQuestion?: boolean
	replyMatches?: RegExp
	replyNotMatches?: RegExp
}

type ScenarioType = {
	name: string
	text: string
	gate: boolean
	expect: ScenarioExpectType
}

type InteractionRowType = {
	intent_decision: string | null
	tool_call_count: number | null
	skill_response: string | null
	llm_response: string | null
	status: string | null
	llm_ms: number | null
	total_ms: number | null
}

type ToolEntryType = { kind?: string; tool?: string; status?: string }

type ResultType = {
	name: string
	text: string
	gate: boolean
	pass: boolean
	detail: string
	reply: string
	tools: string[]
	intent: string | null
	totalMs: number | null
}

const SETTLE_MS = 600
const READ_TOOL_RE = /GetLiveContext|GetDateTime|get_items|GetState|List/i
const CONFIRM_RE = /do you want me|want me to|go ahead/i
const TIME_RE =
	/\d|o'clock|noon|midnight|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty)\b.*\b(morning|afternoon|evening|night|am|pm)\b/i

const SCENARIOS: ScenarioType[] = [
	{
		name: "state query: office lights",
		text: "Are the office lights on right now?",
		gate: true,
		expect: { noWrites: true, replyNotQuestion: true },
	},
	{
		name: "state query: office light (singular)",
		text: "Is the office light on?",
		gate: true,
		expect: { noWrites: true, replyNotQuestion: true },
	},
	{
		name: "state query: TV",
		text: "Is the TV on?",
		gate: true,
		expect: { noWrites: true, replyNotQuestion: true },
	},
	{
		name: "command: turn on (fast-path)",
		text: "Turn on the office lights",
		gate: true,
		expect: { tools: ["HassTurnOn"], fastPath: true },
	},
	{
		name: "numeric: dim to fifty percent (fast-path)",
		text: "Dim the office lights to fifty percent",
		gate: true,
		expect: { tools: ["HassLightSet"], fastPath: true },
	},
	{
		name: "state query after action (must say on)",
		text: "Is the office light on?",
		gate: true,
		expect: {
			noWrites: true,
			replyNotQuestion: true,
			replyMatches: /\bon\b/i,
			replyNotMatches: /\boff\b/i,
		},
	},
	{
		name: "state query: sconces status (must say off)",
		text: "What's the status of the exterior sconces?",
		gate: false,
		expect: {
			noWrites: true,
			replyNotQuestion: true,
			replyMatches: /\boff\b/i,
			replyNotMatches: /\bon\b(?!\s+the)/i,
		},
	},
	{
		name: "state query: which lights are on (must name office)",
		text: "Which lights are on right now?",
		gate: false,
		expect: { noWrites: true, replyNotQuestion: true, replyMatches: /office/i },
	},
	{
		name: "read tool: what time is it",
		text: "What time is it?",
		gate: false,
		expect: { noWrites: true, replyMatches: TIME_RE },
	},
	{
		name: "numeric: set to twenty percent (fast-path)",
		text: "Set the office lights to twenty percent",
		gate: true,
		expect: { tools: ["HassLightSet"], fastPath: true },
	},
	{
		name: "anaphora: make it brighter (agent)",
		text: "Make it brighter",
		gate: false,
		expect: { tools: ["HassLightSet"] },
	},
	{
		name: "area off via agent: all the lights in the office",
		text: "Turn off all the lights in the office",
		gate: false,
		expect: { tools: ["HassTurnOff"] },
	},
	{
		name: "state query after off (must say off)",
		text: "Is the office light on?",
		gate: true,
		expect: {
			noWrites: true,
			replyNotQuestion: true,
			replyMatches: /\boff\b|\bnot\b|\bno\b/i,
		},
	},
	{
		name: "compound: on + on (fast-path)",
		text: "Turn on the office lights and the exterior sconces",
		gate: true,
		expect: { tools: ["HassTurnOn", "HassTurnOn"], compound: 2 },
	},
	{
		name: "compound: off + off (fast-path)",
		text: "Turn off the office lights and the exterior sconces",
		gate: true,
		expect: { tools: ["HassTurnOff", "HassTurnOff"], compound: 2 },
	},
	{
		name: "negation: no tool",
		text: "Don't turn on the office lights",
		gate: true,
		expect: { noTools: true },
	},
	{
		name: "chat: no tool",
		text: "Tell me a one-line joke",
		gate: true,
		expect: { noTools: true },
	},
	{
		name: "agent write: brighter (model quality)",
		text: "Please make the office lights a bit brighter",
		gate: false,
		expect: { tools: ["HassLightSet"] },
	},
	{
		name: "polite modal: can you turn off the office lights (agent)",
		text: "Can you turn off the office lights?",
		gate: true,
		expect: { tools: ["HassTurnOff"] },
	},
	{
		name: "polite modal ES twin: puedes apagar la luz de la oficina",
		text: "¿Puedes apagar la luz de la oficina?",
		gate: false,
		expect: { tools: ["HassTurnOff"] },
	},
	{
		name: "cleanup: turn off (fast-path)",
		text: "Turn off the office lights",
		gate: true,
		expect: { tools: ["HassTurnOff"], fastPath: true },
	},
]

const checker = makeChecker()
const labelIdx = process.argv.indexOf("--label")
const label = labelIdx >= 0 ? process.argv[labelIdx + 1] : "tool-scenarios"

const postChat = async (
	text: string,
): Promise<{ interactionId: string; reply: string; totalMs: number }> => {
	const res = await fetch(
		`${env.EVAL_URL}/chat?domiaKey=${env.EVAL_DOMIA_KEY}`,
		{
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify({ text }),
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
): Promise<InteractionRowType | null> => {
	const start = Date.now()
	while (Date.now() - start < env.EVAL_POLL_TIMEOUT_MS) {
		const row = queryOne<InteractionRowType>(
			"SELECT intent_decision, tool_call_count, skill_response, llm_response, status, llm_ms, total_ms FROM interaction_trace WHERE id = ?",
			[interactionId],
		)
		if (row && (row.status === "ok" || row.status === "failed")) {
			await sleep(SETTLE_MS)
			return (
				queryOne<InteractionRowType>(
					"SELECT intent_decision, tool_call_count, skill_response, llm_response, status, llm_ms, total_ms FROM interaction_trace WHERE id = ?",
					[interactionId],
				) ?? row
			)
		}
		await sleep(200)
	}
	return null
}

const toolsOf = (row: InteractionRowType | null): string[] => {
	if (!row?.skill_response) return []
	try {
		const entries = JSON.parse(row.skill_response) as ToolEntryType[]
		return entries
			.filter((e) => e.kind === "result" && e.tool)
			.map((e) => String(e.tool).split("__").pop() ?? "")
	} catch {
		return []
	}
}

const evaluate = (
	scenario: ScenarioType,
	reply: string,
	row: InteractionRowType | null,
): { pass: boolean; detail: string } => {
	const tools = toolsOf(row)
	const intent = row?.intent_decision ?? ""
	const reasons: string[] = []
	const e = scenario.expect
	if (e.tools && tools.join(",") !== e.tools.join(","))
		reasons.push(
			`tools=${tools.join(",") || "none"} expected=${e.tools.join(",")}`,
		)
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
	if (e.replyMatches && !e.replyMatches.test(reply))
		reasons.push(`reply lacks ${String(e.replyMatches)}`)
	if (e.replyNotMatches?.test(reply))
		reasons.push(`reply contradicts ${String(e.replyNotMatches)}`)
	if (reply.trim().length === 0) reasons.push("empty reply")
	if (reply.trim().startsWith("{")) reasons.push("reply is JSON")
	return { pass: reasons.length === 0, detail: reasons.join("; ") }
}

const main = async (): Promise<void> => {
	const results: ResultType[] = []
	for (const scenario of SCENARIOS) {
		const { interactionId, reply, totalMs } = await postChat(scenario.text)
		const row = await readRow(interactionId)
		const verdict = evaluate(scenario, reply, row)
		const tools = toolsOf(row)
		results.push({
			name: scenario.name,
			text: scenario.text,
			gate: scenario.gate,
			pass: verdict.pass,
			detail: verdict.detail,
			reply,
			tools,
			intent: row?.intent_decision ?? null,
			totalMs: row?.total_ms ?? totalMs,
		})
		const tag = scenario.gate ? "gate" : "score"
		checker.check(
			`[${tag}] ${scenario.name} → "${reply.slice(0, 60)}" (${totalMs}ms)`,
			verdict.pass || !scenario.gate,
			verdict.detail,
		)
		if (!scenario.gate && !verdict.pass)
			console.log(`  ↳ score miss: ${verdict.detail}`)
		await sleep(300)
	}
	const gates = results.filter((r) => r.gate)
	const scores = results.filter((r) => !r.gate)
	const summary = {
		label,
		url: env.EVAL_URL,
		domiaKey: env.EVAL_DOMIA_KEY,
		capturedAt: new Date().toISOString(),
		gatePass: gates.filter((r) => r.pass).length,
		gateTotal: gates.length,
		scorePass: scores.filter((r) => r.pass).length,
		scoreTotal: scores.length,
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
		`\n${label}: gates ${summary.gatePass}/${summary.gateTotal} · score ${summary.scorePass}/${summary.scoreTotal} · median ${summary.medianTotalMs}ms → evals/bench-results/tool-scenarios-${label}.json`,
	)
	process.exit(summary.gatePass === summary.gateTotal ? 0 : 1)
}

void main()

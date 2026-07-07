import Database from "better-sqlite3"
import type {
	EvalTurnRecordType,
	EvalExpectType,
	EvalAssertionType,
} from "./types"

const URL = process.env.EVAL_URL ?? "http://localhost:3100"
const DB_PATH = process.env.EVAL_DB ?? "data/db/a.db"
const DOMIA_KEY = process.env.EVAL_DOMIA_KEY ?? "DOMIA_A"
const POLL_TIMEOUT_MS = Number(process.env.EVAL_POLL_TIMEOUT_MS ?? 20000)
const POLL_INTERVAL_MS = 250

const sleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms))

export const waitForHealth = async (timeoutMs = 15000): Promise<boolean> => {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${URL}/health`)
			if (res.ok) return true
		} catch {
			/* not up yet */
		}
		await sleep(500)
	}
	return false
}

export const postChat = async (
	text: string,
): Promise<{ interactionId: string; reply: string }> => {
	const res = await fetch(`${URL}/chat`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ domiaKey: DOMIA_KEY, text }),
	})
	if (!res.ok) throw new Error(`/chat ${res.status}: ${await res.text()}`)
	const body = (await res.json()) as { interactionId: string; reply: string }
	return body
}

export const postConfig = async (bundle: unknown): Promise<void> => {
	const res = await fetch(`${URL}/config?domiaKey=${DOMIA_KEY}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(bundle),
	})
	if (!res.ok) throw new Error(`/config ${res.status}: ${await res.text()}`)
	await fetch(`${URL}/config/refresh`, { method: "POST" }).catch(
		() => undefined,
	)
}

const openDb = (): Database.Database =>
	new Database(DB_PATH, { readonly: true, fileMustExist: true })

const readRecord = (
	interactionId: string,
	needsTool: boolean,
): EvalTurnRecordType | null => {
	const db = openDb()
	try {
		const row = db
			.prepare(
				`SELECT intent_decision, tool_call_count, llm_ms, ttfa_ms, status, skill_response
				 FROM interaction_trace WHERE id = ?`,
			)
			.get(interactionId) as
			| {
					intent_decision: string | null
					tool_call_count: number | null
					llm_ms: number | null
					ttfa_ms: number | null
					status: string | null
					skill_response: string | null
			  }
			| undefined
		if (!row) return null
		const skillResponse = row.skill_response
			? (JSON.parse(row.skill_response) as unknown[])
			: null
		const hasResolved =
			Array.isArray(skillResponse) &&
			skillResponse.some(
				(e) =>
					e !== null &&
					typeof e === "object" &&
					"resolvedArgs" in (e as Record<string, unknown>),
			)
		if (!row.status) return null
		if (needsTool && (row.tool_call_count ?? 0) > 0 && !hasResolved) return null
		const events = db
			.prepare(
				`SELECT type, seq FROM turn_event WHERE interaction_id = ? ORDER BY seq`,
			)
			.all(interactionId) as { type: string; seq: number }[]
		return {
			interactionId,
			reply: "",
			intentDecision: row.intent_decision,
			toolCallCount: row.tool_call_count,
			llmMs: row.llm_ms,
			ttfaMs: row.ttfa_ms,
			status: row.status,
			skillResponse,
			events,
		}
	} finally {
		db.close()
	}
}

export const pollRecord = async (
	interactionId: string,
	needsTool: boolean,
): Promise<EvalTurnRecordType | null> => {
	const start = Date.now()
	let last: EvalTurnRecordType | null = null
	while (Date.now() - start < POLL_TIMEOUT_MS) {
		last = readRecord(interactionId, needsTool)
		if (last) return last
		await sleep(POLL_INTERVAL_MS)
	}
	return readRecord(interactionId, false) ?? last
}

const toolEntries = (
	rec: EvalTurnRecordType,
): {
	tool?: string
	resolvedArgs?: Record<string, unknown>
	args?: Record<string, unknown>
}[] =>
	(rec.skillResponse ?? []).filter(
		(e): e is { tool?: string } =>
			e !== null && typeof e === "object" && "tool" in e,
	)

const deepSubset = (
	subset: Record<string, unknown>,
	actual: unknown,
): boolean => {
	if (!actual || typeof actual !== "object") return false
	const a = actual as Record<string, unknown>
	return Object.entries(subset).every(([k, v]) => {
		if (v !== null && typeof v === "object")
			return deepSubset(v as Record<string, unknown>, a[k])
		return a[k] === v
	})
}

export const assertTurn = (
	rec: EvalTurnRecordType,
	reply: string,
	expect: EvalExpectType,
): EvalAssertionType[] => {
	const out: EvalAssertionType[] = []
	const add = (name: string, ok: boolean, detail?: string): void => {
		out.push({ name, ok, detail })
	}
	const tools = toolEntries(rec)
	const toolNames = tools.map((t) => t.tool ?? "")
	const rawName = (t: string): string => {
		const i = t.indexOf("__")
		return i >= 0 ? t.slice(i + 2) : t
	}

	if (expect.routed === "skill")
		add(
			"routed=skill",
			(rec.toolCallCount ?? 0) > 0 || /skill/i.test(rec.intentDecision ?? ""),
			`intent=${rec.intentDecision} tools=${rec.toolCallCount}`,
		)
	if (expect.routed === "chat")
		add(
			"routed=chat",
			(rec.toolCallCount ?? 0) === 0,
			`tools=${rec.toolCallCount}`,
		)
	if (expect.routed === "fast")
		add(
			"routed=fast",
			rec.llmMs === null && (rec.toolCallCount ?? 0) === 0,
			`llmMs=${rec.llmMs}`,
		)

	if (expect.tool)
		add(
			`tool=${expect.tool}`,
			toolNames.some((t) => rawName(t) === expect.tool),
			`got=${toolNames.join(",")}`,
		)
	if (expect.notTools) {
		const banned = expect.notTools
		add(
			`notTools`,
			!toolNames.some((t) => banned.includes(rawName(t))),
			`got=${toolNames.join(",")}`,
		)
	}

	if (expect.argsSubset || expect.argMatchers) {
		const target = tools.find(
			(t) => !expect.tool || rawName(t.tool ?? "") === expect.tool,
		)
		const resolved = (target?.resolvedArgs ?? target?.args ?? {}) as Record<
			string,
			unknown
		>
		if (expect.argsSubset)
			add(
				"argsSubset",
				deepSubset(expect.argsSubset, resolved),
				JSON.stringify(resolved),
			)
		if (expect.argMatchers)
			for (const [k, pat] of Object.entries(expect.argMatchers))
				add(
					`argMatch:${k}~/${pat}/`,
					new RegExp(pat, "i").test(String(resolved[k] ?? "")),
					`${k}=${String(resolved[k])}`,
				)
	}

	if (expect.replyIncludes)
		for (const s of expect.replyIncludes)
			add(
				`replyIncludes:${s}`,
				reply.toLowerCase().includes(s.toLowerCase()),
				reply,
			)

	if (expect.maxTtfaMs != null)
		add(
			`ttfa<=${expect.maxTtfaMs}`,
			(rec.ttfaMs ?? Infinity) <= expect.maxTtfaMs,
			`ttfa=${rec.ttfaMs}`,
		)

	if (expect.status)
		add(
			`status=${expect.status}`,
			rec.status === expect.status,
			`status=${rec.status}`,
		)

	const ev = expect.expectEvents
	if (ev) {
		const types = rec.events.map((e) => e.type)
		if (ev.present)
			for (const t of ev.present)
				add(`event:${t}`, types.includes(t), `events=${types.join(",")}`)
		if (ev.seqOrdered) {
			const seqs = rec.events.map((e) => e.seq)
			add(
				"seqOrdered",
				seqs.every((s, i) => i === 0 || s > seqs[i - 1]),
				seqs.join(","),
			)
		}
		if (ev.completedAfterPlayback) {
			const pf = rec.events.find((e) => e.type === "playback.finished")?.seq
			const tc = rec.events.find((e) => e.type === "turn.completed")?.seq
			add(
				"completedAfterPlayback",
				pf == null || tc == null || tc > pf,
				`pf=${pf} tc=${tc}`,
			)
		}
	}

	return out
}

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"

import {
	env,
	waitForHealth,
	postChat,
	pollRecord,
	assertTurn,
	assertCoherence,
	judgeReply,
	evalCaseFileSchema,
	configSnapshot,
	factMatches,
	factRows,
	isolateConversation,
	resetConversation,
	seedCaseFacts,
	sleep,
} from "./lib"
import {
	BENCH_DOMIA_KEY,
	ensureBenchIdentity,
	teardownBenchIdentity,
} from "./lib/bench-identity"
import type {
	EvalCaseType,
	EvalTurnType,
	EvalAssertionType,
	EvalTurnRecordType,
} from "./types"

const CASES_DIR = join(process.cwd(), "evals", "cases")
const RESULTS_DIR = join(process.cwd(), "evals", "results")
const LABEL =
	env.LABEL ??
	`conv-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`

// reflection is idle-only with an idle grace — facts land well after the turn on a busy hub
const FACT_CAPTURE_TIMEOUT_MS = 120000
const NEGATIVE_SETTLE_MS = 18000

const dbFactAssertions = async (
	turn: EvalTurnType,
): Promise<EvalAssertionType[]> => {
	const out: EvalAssertionType[] = []
	if (!turn.expect.factInDb && !turn.expect.noFactInDb) return out
	if (turn.expect.factInDb) {
		const ref = turn.expect.factInDb
		const start = Date.now()
		let rows = factRows()
		while (
			!factMatches(rows, ref) &&
			Date.now() - start < FACT_CAPTURE_TIMEOUT_MS
		) {
			await sleep(400)
			rows = factRows()
		}
		out.push({
			name: `factInDb:${ref.value}`,
			ok: factMatches(rows, ref),
			detail: rows.map((r) => `${r.subject}|${r.value}`).join(", "),
		})
	}
	if (turn.expect.noFactInDb) {
		const ref = turn.expect.noFactInDb
		const settleDeadline = Date.now() + NEGATIVE_SETTLE_MS
		let rows = factRows()
		while (!factMatches(rows, ref) && Date.now() < settleDeadline) {
			await sleep(1500)
			rows = factRows()
		}
		out.push({
			name: `noFactInDb:${ref.value}`,
			ok: !factMatches(rows, ref),
			detail: rows.map((r) => `${r.subject}|${r.value}`).join(", "),
		})
	}
	if (turn.expect.factCountAtMost) {
		const ref = turn.expect.factCountAtMost
		const matchesOf = () =>
			factRows().filter((r) =>
				r.value.toLowerCase().includes(ref.value.toLowerCase()),
			)
		const start = Date.now()
		while (
			matchesOf().length === 0 &&
			Date.now() - start < FACT_CAPTURE_TIMEOUT_MS
		) {
			await sleep(400)
		}
		const settleDeadline = Date.now() + FACT_CAPTURE_TIMEOUT_MS
		let matches = matchesOf()
		while (
			matches.length > 0 &&
			matches.length <= ref.count &&
			Date.now() < settleDeadline
		) {
			await sleep(1500)
			matches = matchesOf()
		}
		out.push({
			name: `factCountAtMost:${ref.value}<=${ref.count}`,
			ok: matches.length > 0 && matches.length <= ref.count,
			detail: matches.map((r) => `${r.subject}|${r.value}`).join(", "),
		})
	}
	return out
}

const recalledFactsOf = (rec: EvalTurnRecordType | null): string => {
	const prompt = rec?.llmPrompt ?? ""
	const start = prompt.split("\n").findIndex((l) => l === "### WHAT YOU KNOW")
	if (start < 0) return "(none)"
	const lines = prompt.split("\n").slice(start + 1)
	const body: string[] = []
	for (const l of lines) {
		if (l.startsWith("### ")) break
		if (l.trim().startsWith("-")) body.push(l.trim())
	}
	return body.length ? body.join(" ") : "(none)"
}

type ConversationTranscriptType = {
	name: string
	turns: {
		user: string
		reply: string
		routed: string
		recalledFacts: string
		assertions: EvalAssertionType[]
	}[]
}

const runConversation = async (
	c: EvalCaseType,
): Promise<{ passed: boolean; transcript: ConversationTranscriptType }> => {
	if (c.isolate === "session") await resetConversation()
	else await isolateConversation()
	await seedCaseFacts(c)
	const transcript: ConversationTranscriptType = { name: c.name, turns: [] }
	let passed = true
	for (const turn of c.turns) {
		if (turn.expect.recallsFact) {
			const ref = turn.expect.recallsFact
			const start = Date.now()
			while (
				!factMatches(factRows(), ref) &&
				Date.now() - start < FACT_CAPTURE_TIMEOUT_MS
			) {
				await sleep(500)
			}
		}
		const { interactionId, reply } = await postChat(turn.text)
		const needsTool = Boolean(
			turn.expect.tool || turn.expect.argsSubset || turn.expect.argMatchers,
		)
		const rec = await pollRecord(interactionId, needsTool)
		const assertions: EvalAssertionType[] = []
		if (!rec) {
			assertions.push({ name: "record", ok: false, detail: "no trace row" })
		} else {
			assertions.push(...assertTurn(rec, reply, turn.expect))
			assertions.push(
				...assertCoherence(
					reply,
					turn.text,
					transcript.turns.map((t) => t.reply),
					turn.expect,
				),
			)
			assertions.push(...(await dbFactAssertions(turn)))
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
		if (assertions.some((a) => !a.ok)) passed = false
		transcript.turns.push({
			user: turn.text,
			reply,
			routed:
				(rec?.toolCallCount ?? 0) > 0 ? `skill(${rec?.toolCallCount})` : "chat",
			recalledFacts: recalledFactsOf(rec),
			assertions,
		})
		await sleep(600)
	}
	return { passed, transcript }
}

const renderTranscript = (
	t: ConversationTranscriptType,
	passed: boolean,
): string => {
	const lines: string[] = [`## ${t.name} — ${passed ? "PASS" : "FAIL"}`, ""]
	for (const [i, turn] of t.turns.entries()) {
		lines.push(`### Turn ${i + 1} · routed=${turn.routed}`)
		lines.push(`- **User:** ${turn.user}`)
		lines.push(`- **Domia:** ${turn.reply}`)
		lines.push(`- **Recalled facts:** ${turn.recalledFacts}`)
		for (const a of turn.assertions)
			lines.push(
				`  - ${a.ok ? "✅" : "❌"} ${a.name}${a.ok ? "" : ` — ${a.detail ?? ""}`}`,
			)
		lines.push("")
	}
	return lines.join("\n")
}

const loadConversationCases = (): EvalCaseType[] => {
	const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json"))
	const cases: EvalCaseType[] = []
	for (const f of files) {
		const raw: unknown = JSON.parse(readFileSync(join(CASES_DIR, f), "utf8"))
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
	return cases.filter((c) => c.suite === "conversation")
}

const main = async (): Promise<void> => {
	if (!(await waitForHealth())) {
		console.error("node not healthy")
		process.exit(1)
	}

	let cases = loadConversationCases()
	const caseFilter = env.EVAL_CASE_FILTER
	if (caseFilter) cases = cases.filter((c) => c.name.includes(caseFilter))
	if (cases.length === 0) {
		console.error('no cases with suite "conversation" found')
		process.exit(1)
	}

	await ensureBenchIdentity()
	env.EVAL_DOMIA_KEY = BENCH_DOMIA_KEY
	const snap = configSnapshot()
	console.log(
		`\n=== conversation eval · ${env.EVAL_URL} · ${BENCH_DOMIA_KEY} ===`,
	)
	console.log(`flags: ${snap.flags}\n`)

	mkdirSync(RESULTS_DIR, { recursive: true })
	const transcripts: string[] = []
	let passedCount = 0
	try {
		for (const c of cases) {
			const runs = c.runs ?? 1
			const passRatio = c.passRatio ?? 1
			let runsPassed = 0
			let lastFail: ConversationTranscriptType | null = null
			let lastPass: ConversationTranscriptType | null = null
			for (let i = 0; i < runs; i++) {
				const { passed, transcript } = await runConversation(c)
				if (passed) {
					runsPassed++
					lastPass = transcript
				} else {
					lastFail = transcript
				}
			}
			const casePassed = runsPassed / runs >= passRatio
			if (casePassed) passedCount++
			console.log(
				`${casePassed ? "✅" : "❌"} ${c.name} (${runsPassed}/${runs})`,
			)
			const show = lastFail ?? lastPass
			if (!casePassed && show)
				for (const turn of show.turns)
					for (const a of turn.assertions)
						if (!a.ok) console.log(`     ❌ ${a.name} — ${a.detail ?? ""}`)
			transcripts.push(
				renderTranscript(show ?? { name: c.name, turns: [] }, casePassed),
			)
		}
	} finally {
		await teardownBenchIdentity().catch(() => undefined)
	}

	const out = join(RESULTS_DIR, `conversation-${LABEL}.md`)
	writeFileSync(
		out,
		`# Conversation transcripts — ${LABEL}\n\nflags: ${snap.flags}\n\n${transcripts.join("\n---\n\n")}`,
	)
	console.log(`\n${passedCount}/${cases.length} conversations passed`)
	console.log(
		`transcript → ${join("evals/results", `conversation-${LABEL}.md`)}`,
	)
	process.exit(passedCount === cases.length ? 0 : 1)
}

void main()

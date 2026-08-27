import { execFileSync } from "child_process"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"

import { env, meshHeaders, queryAll, sleep, judgePairwise } from "./lib"
import { BENCH_DOMIA_KEY, ensureBenchIdentity } from "./lib/bench-identity"
import { runtimeSnapshot } from "./lib/snapshot"
import type {
	TourneyCaseResultType,
	TourneyModelResultType,
	TourneyTurnReplyType,
} from "./types"

const MODELS = (
	process.env.TOURNEY_MODELS ??
	"llama3.2:3b,oamazonasgabriel/lfm2.5-2.6b:q4_k_m-8gbGPU,granite4:micro,qwen2.5:3b"
)
	.split(",")
	.map((m) => m.trim())
	.filter(Boolean)

const INCUMBENT = MODELS[0]
const OUT_DIR = path.resolve("evals/bench-results")
const PAIRWISE_RUBRIC =
	"a short spoken reply from a warm home companion: correct, natural, brief, in character; penalize invented details, repetition and ignoring the user"

const waitHealthy = async (): Promise<void> => {
	for (let i = 0; i < 60; i++) {
		const ok = await fetch(`${env.EVAL_URL}/health`)
			.then((r) => r.ok)
			.catch(() => false)
		if (ok) return
		await sleep(1000)
	}
	throw new Error("node not healthy")
}

const setModel = async (modelName: string): Promise<void> => {
	for (let attempt = 0; attempt < 3; attempt++) {
		await waitHealthy()
		try {
			const res = await fetch(
				`${env.EVAL_URL}/config?domiaKey=${encodeURIComponent(BENCH_DOMIA_KEY)}`,
				{
					method: "POST",
					headers: { "content-type": "application/json", ...meshHeaders() },
					body: JSON.stringify({ llm: { modelName } }),
				},
			)
			if (!res.ok) throw new Error(`model swap failed: ${res.status}`)
			const refresh = await fetch(
				`${env.EVAL_URL}/config/refresh?domiaKey=${encodeURIComponent(BENCH_DOMIA_KEY)}`,
				{ method: "POST", headers: meshHeaders() },
			)
			if (!refresh.ok)
				throw new Error(`config refresh failed: ${refresh.status}`)
			return
		} catch (err) {
			if (attempt === 2) throw err
			await sleep(2000)
		}
	}
}

const warmTurn = async (): Promise<void> => {
	await fetch(`${env.EVAL_URL}/chat`, {
		method: "POST",
		headers: { "content-type": "application/json", ...meshHeaders() },
		body: JSON.stringify({ domiaKey: BENCH_DOMIA_KEY, text: "Hello!" }),
	}).catch(() => undefined)
	await sleep(500)
}

const labelFor = (model: string): string =>
	`tourney-${model.replace(/[^a-z0-9.]+/gi, "-")}`

const runCorpus = (model: string): string => {
	const label = labelFor(model)
	try {
		execFileSync("npx", ["tsx", "evals/conversation.ts"], {
			env: {
				...process.env,
				EVAL_DOMIA_KEY: BENCH_DOMIA_KEY,
				LABEL: label,
				EVAL_CASE_FILTER: process.env.TOURNEY_CASE_FILTER ?? "quality",
			},
			stdio: ["ignore", "inherit", "inherit"],
		})
	} catch {
		/* nonzero exit = failed cases, which the transcript records — expected for candidates */
	}
	return path.resolve(`evals/results/conversation-${label}.md`)
}

const parseTranscript = (
	file: string,
): { cases: TourneyCaseResultType[]; replies: TourneyTurnReplyType[] } => {
	const text = readFileSync(file, "utf-8")
	const cases: TourneyCaseResultType[] = []
	const replies: TourneyTurnReplyType[] = []
	let currentCase = ""
	let turnIndex = -1
	let lastUser = ""
	for (const line of text.split("\n")) {
		const caseHead = line.match(/^## (.+) — (PASS|FAIL)$/)
		if (caseHead) {
			currentCase = caseHead[1]
			turnIndex = -1
			cases.push({ name: currentCase, passed: caseHead[2] === "PASS" })
			continue
		}
		if (/^### Turn /.test(line)) turnIndex++
		const user = line.match(/^- \*\*User:\*\* (.*)$/)
		if (user) lastUser = user[1]
		const domia = line.match(/^- \*\*Domia:\*\* (.*)$/)
		if (domia && currentCase)
			replies.push({
				caseName: currentCase,
				turnIndex,
				user: lastUser,
				reply: domia[1],
			})
	}
	return { cases, replies }
}

const speedStats = (
	model: string,
	sinceIso: string,
): {
	ttftP50Ms: number | null
	tokensPerSecP50: number | null
	llmMsP50: number | null
} => {
	const rows = queryAll<{
		ttft: number | null
		tps: number | null
		llmMs: number | null
	}>(
		`SELECT it.llm_ttft_ms ttft, it.llm_tokens_per_sec tps, it.llm_ms llmMs
		 FROM interaction_trace it JOIN domia d ON d.id = it.domia_id
		 WHERE d.domia_key = ? AND it.llm_model_used = ? AND it.created_at >= ?
		 AND it.llm_ms IS NOT NULL`,
		[BENCH_DOMIA_KEY, model, sinceIso],
	)
	const p50 = (values: (number | null)[]): number | null => {
		const nums = values
			.filter((v): v is number => v !== null)
			.sort((a, z) => a - z)
		if (!nums.length) return null
		return Math.round(nums[Math.floor(nums.length / 2)])
	}
	return {
		ttftP50Ms: p50(rows.map((r) => r.ttft)),
		tokensPerSecP50: p50(rows.map((r) => r.tps)),
		llmMsP50: p50(rows.map((r) => r.llmMs)),
	}
}

const main = async (): Promise<void> => {
	await ensureBenchIdentity()
	mkdirSync(OUT_DIR, { recursive: true })
	const results: TourneyModelResultType[] = []
	const repliesByModel = new Map<string, TourneyTurnReplyType[]>()

	try {
		await runTournament(results, repliesByModel)
	} finally {
		await setModel(INCUMBENT).catch((err) =>
			console.error("incumbent restore failed:", err),
		)
	}
	report(results)
}

const runTournament = async (
	results: TourneyModelResultType[],
	repliesByModel: Map<string, TourneyTurnReplyType[]>,
): Promise<void> => {
	for (const model of MODELS) {
		console.log(`\n=== candidate: ${model} ===`)
		const sinceIso = new Date().toISOString().replace("T", " ").slice(0, 19)
		await setModel(model)
		await warmTurn()
		const transcript = runCorpus(model)
		const { cases, replies } = parseTranscript(transcript)
		repliesByModel.set(model, replies)
		const speed = speedStats(model, sinceIso)
		results.push({
			model,
			casesPassed: cases.filter((c) => c.passed).length,
			casesTotal: cases.length,
			cases,
			...speed,
			pairwise: { wins: 0, losses: 0, ties: 0 },
			transcript: path.relative(process.cwd(), transcript),
		})
	}

	const incumbentReplies = repliesByModel.get(INCUMBENT) ?? []
	for (const result of results) {
		if (result.model === INCUMBENT) continue
		const candidateReplies = repliesByModel.get(result.model) ?? []
		for (const inc of incumbentReplies) {
			const cand = candidateReplies.find(
				(r) => r.caseName === inc.caseName && r.turnIndex === inc.turnIndex,
			)
			if (!cand || !inc.reply || !cand.reply) continue
			const winner = await judgePairwise(
				inc.user,
				inc.reply,
				cand.reply,
				PAIRWISE_RUBRIC,
			)
			if (winner === "B") result.pairwise.wins++
			else if (winner === "A") result.pairwise.losses++
			else result.pairwise.ties++
		}
	}
}

const report = (results: TourneyModelResultType[]): void => {
	console.log(`\n=== evals:llm-tournament (incumbent: ${INCUMBENT}) ===`)
	console.log(
		"model".padEnd(22),
		"cases".padEnd(8),
		"vs-incumbent (w/l/t)".padEnd(22),
		"ttft-p50".padEnd(10),
		"tok/s-p50".padEnd(10),
		"llm-p50",
	)
	for (const r of results) {
		const pw =
			r.model === INCUMBENT
				? "—"
				: `${r.pairwise.wins}/${r.pairwise.losses}/${r.pairwise.ties}`
		console.log(
			r.model.padEnd(22),
			`${r.casesPassed}/${r.casesTotal}`.padEnd(8),
			pw.padEnd(22),
			String(r.ttftP50Ms ?? "—").padEnd(10),
			String(r.tokensPerSecP50 ?? "—").padEnd(10),
			String(r.llmMsP50 ?? "—"),
		)
	}

	const artifact = {
		label: process.env.LABEL ?? "llm-tournament-mac",
		snapshot: runtimeSnapshot(),
		incumbent: INCUMBENT,
		results,
	}
	const outPath = path.join(OUT_DIR, `${artifact.label}.json`)
	writeFileSync(outPath, JSON.stringify(artifact, null, "\t"))
	console.log(`\nresults → ${path.relative(process.cwd(), outPath)}`)
}

void main()

import { parseLlmJson } from "@/utils/llm-json"

import { env } from "./env"
import type {
	ConversationJudgeVerdictType,
	JudgeEngineType,
	JudgePanelMemberType,
	JudgeSpecType,
	JudgeVerdictType,
	PairwiseWinnerType,
} from "../types"

const clip = (s: string, n = 300): string =>
	s.replace(/\s+/g, " ").trim().slice(0, n)

const JUDGE_TIMEOUT_MS = 120_000
const JUDGE_ATTEMPTS = 2
const SCORE_MIN = 1
const SCORE_MAX = 5
const MAX_ISSUES = 5
const ENGINES: JudgeEngineType[] = ["ollama", "openai"]

const parseSpec = (raw: string): JudgeSpecType => {
	const trimmed = raw.trim()
	const engine = ENGINES.find((e) => trimmed.startsWith(`${e}:`))
	if (!engine) return { engine: "ollama", model: trimmed, label: trimmed }
	return {
		engine,
		model: trimmed.slice(engine.length + 1),
		label: trimmed,
	}
}

export const judgePanelSpecs = (): JudgeSpecType[] => {
	const specs = (env.EVAL_JUDGE_MODELS ?? env.EVAL_JUDGE_MODEL)
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map(parseSpec)
	return specs.length > 0 ? specs : [parseSpec(env.EVAL_JUDGE_MODEL)]
}

const askOllama = async (
	spec: JudgeSpecType,
	prompt: string,
): Promise<string | null> => {
	const res = await fetch(`${env.EVAL_JUDGE_HOST}/api/generate`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
		body: JSON.stringify({
			model: spec.model,
			stream: false,
			format: "json",
			options: { temperature: 0 },
			prompt,
		}),
	})
	if (!res.ok) return null
	const json = (await res.json()) as { response?: string }
	return json.response ?? null
}

const askOpenAi = async (
	spec: JudgeSpecType,
	prompt: string,
): Promise<string | null> => {
	const res = await fetch(`${env.EVAL_JUDGE_OPENAI_HOST}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
		body: JSON.stringify({
			model: spec.model,
			stream: false,
			temperature: 0,
			response_format: { type: "json_object" },
			messages: [{ role: "user", content: prompt }],
		}),
	})
	if (!res.ok) return null
	const json = (await res.json()) as {
		choices?: { message?: { content?: string } }[]
	}
	return json.choices?.[0]?.message?.content ?? null
}

const attemptJson = async (
	spec: JudgeSpecType,
	prompt: string,
): Promise<Record<string, unknown> | null> => {
	try {
		const raw =
			spec.engine === "openai"
				? await askOpenAi(spec, prompt)
				: await askOllama(spec, prompt)
		if (raw === null) return null
		const parsed = parseLlmJson(raw)
		if (parsed.value === null) return null
		if (parsed.state === "repaired")
			console.warn(
				`⚠️ judge ${spec.label} JSON repaired (rawLength ${raw.length})`,
			)
		return parsed.value
	} catch {
		return null
	}
}

const generateJson = async (
	spec: JudgeSpecType,
	prompt: string,
): Promise<Record<string, unknown>> => {
	for (let attempt = 0; attempt < JUDGE_ATTEMPTS; attempt++) {
		const parsed = await attemptJson(spec, prompt)
		if (parsed !== null) return parsed
	}
	return {
		reason: `judge ${spec.label} unavailable after ${JUDGE_ATTEMPTS} tries`,
	}
}

const readScore = (value: unknown): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0
	return Math.min(SCORE_MAX, Math.max(SCORE_MIN, value))
}

const readIssues = (value: unknown): string[] =>
	Array.isArray(value)
		? value
				.filter((i): i is string => typeof i === "string")
				.slice(0, MAX_ISSUES)
		: []

const median = (xs: number[]): number => {
	if (xs.length === 0) return 0
	const s = [...xs].sort((a, b) => a - b)
	const mid = Math.floor(s.length / 2)
	return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const runPanel = async (
	build: (swapped: boolean) => string,
): Promise<ConversationJudgeVerdictType> => {
	const panel: JudgePanelMemberType[] = []
	const issues: string[] = []
	for (const spec of judgePanelSpecs()) {
		const runs = await Promise.all(
			[false, true].map(async (swapped) => generateJson(spec, build(swapped))),
		)
		const scores = runs.map((r) => readScore(r.score))
		const scored = scores.filter((s) => s > 0)
		const reasons = runs.map((r, i) => ({
			text: typeof r.reason === "string" ? r.reason : "",
			ok: scores[i] > 0,
		}))
		const reason =
			reasons.find((r) => r.ok && r.text.length > 0)?.text ??
			reasons.find((r) => r.text.length > 0)?.text
		panel.push({
			judge: spec.label,
			score: scored.length
				? round2(scored.reduce((a, s) => a + s, 0) / scored.length)
				: 0,
			reason: reason ?? "unparsed",
			positionScores: scores,
		})
		for (const issue of runs.flatMap((r) => readIssues(r.issues)))
			if (!issues.includes(issue)) issues.push(issue)
	}
	const voted = panel.filter((m) => m.score > 0)
	const score = median(voted.map((m) => m.score))
	const near = voted.filter((m) => Math.abs(m.score - score) <= 1)
	const closest = [...voted].sort(
		(a, b) => Math.abs(a.score - score) - Math.abs(b.score - score),
	)[0]
	for (const silent of panel.filter((m) => m.score === 0))
		console.warn(`⚠️ judge ${silent.judge} did not score — ${silent.reason}`)
	return {
		score,
		reason: voted.length ? closest.reason : "not judged",
		agreement: voted.length ? round2(near.length / voted.length) : 0,
		panel,
		issues: issues.slice(0, MAX_ISSUES),
	}
}

export const judgeReply = async (
	question: string,
	reply: string,
	rubric: string,
): Promise<JudgeVerdictType> => {
	const exchange = `User said: "${clip(question)}"
Companion replied: "${clip(reply)}"`
	const criteria = `Rubric for this turn: ${rubric}`
	const verdict = await runPanel(
		(
			swapped,
		) => `You judge ONE turn of a casual VOICE companion (like a friend at home, not a search engine).
${swapped ? `${criteria}\n${exchange}` : `${exchange}\n${criteria}`}
Score 1-5 against the rubric. Brevity is GOOD for a spoken reply — only penalize what the rubric targets, nonsense, contradictions, or ignoring the user.
Return JSON {"score": number, "reason": "one short line"}.`,
	)
	return {
		score: verdict.score,
		reason: verdict.reason,
		agreement: verdict.agreement,
		panel: verdict.panel,
	}
}

const TRANSCRIPT_TURN_CHARS = 220

export const judgeConversation = async (
	turns: { user: string; reply: string }[],
	rubric: string,
): Promise<ConversationJudgeVerdictType> => {
	const transcript = turns
		.map(
			(t, i) =>
				`${i + 1}. User: ${clip(t.user, TRANSCRIPT_TURN_CHARS)}\n   Domia: ${clip(t.reply, TRANSCRIPT_TURN_CHARS)}`,
		)
		.join("\n")
	const body = `Transcript (${turns.length} turns):
${transcript}`
	const criteria = `Rubric: ${rubric}`
	return runPanel(
		(
			swapped,
		) => `You judge a WHOLE conversation with a casual VOICE companion that also controls devices at home.
${swapped ? `${criteria}\n\n${body}` : `${body}\n\n${criteria}`}

Score the conversation 1-5 as a whole. Brevity is GOOD for spoken replies — only penalize what the rubric targets, contradictions, forgetting what was just said, repeating itself, inventing device state, or ignoring the user.
Return JSON {"score": number, "reason": "one short line", "issues": ["short phrase", ...]} with at most five issues.`,
	)
}

const askWinner = async (
	spec: JudgeSpecType,
	question: string,
	replyA: string,
	replyB: string,
	rubric: string,
): Promise<string> => {
	const parsed = await generateJson(
		spec,
		`Two VOICE-companion replies to the user message: "${clip(question)}".
Reply A: "${clip(replyA)}"
Reply B: "${clip(replyB)}"
Which reply is better as a short spoken answer, judged by: ${rubric}
Penalize invented details, repetition, and ignoring the user. Return ONLY JSON {"winner":"A" or "B","why":"one short line"}.`,
	)
	return typeof parsed.winner === "string" ? parsed.winner : "tie"
}

export const judgePairwise = async (
	question: string,
	replyA: string,
	replyB: string,
	rubric: string,
): Promise<PairwiseWinnerType> => {
	const votes: PairwiseWinnerType[] = []
	for (const spec of judgePanelSpecs()) {
		const [first, swapped] = await Promise.all([
			askWinner(spec, question, replyA, replyB, rubric),
			askWinner(spec, question, replyB, replyA, rubric),
		])
		if (first === "A" && swapped === "B") votes.push("A")
		else if (first === "B" && swapped === "A") votes.push("B")
		else votes.push("tie")
	}
	const a = votes.filter((v) => v === "A").length
	const b = votes.filter((v) => v === "B").length
	if (a > b) return "A"
	if (b > a) return "B"
	return "tie"
}

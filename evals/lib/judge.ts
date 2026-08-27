import { env } from "./env"
import type { JudgeVerdictType, PairwiseWinnerType } from "../types"

const clip = (s: string, n = 300): string =>
	s.replace(/\s+/g, " ").trim().slice(0, n)

const JUDGE_TIMEOUT_MS = 120_000

const generateJson = async (
	prompt: string,
): Promise<Record<string, unknown>> => {
	try {
		const res = await fetch(`${env.EVAL_JUDGE_HOST}/api/generate`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
			body: JSON.stringify({
				model: env.EVAL_JUDGE_MODEL,
				stream: false,
				format: "json",
				options: { temperature: 0 },
				prompt,
			}),
		})
		if (!res.ok) return { reason: `judge unavailable (${res.status})` }
		const json = (await res.json()) as { response?: string }
		return JSON.parse(json.response ?? "{}") as Record<string, unknown>
	} catch {
		return { reason: "judge unavailable (timeout or unreachable)" }
	}
}

export const judgeReply = async (
	question: string,
	reply: string,
	rubric: string,
): Promise<JudgeVerdictType> => {
	const parsed = await generateJson(
		`You judge ONE turn of a casual VOICE companion (like a friend at home, not a search engine).
User said: "${clip(question)}"
Companion replied: "${clip(reply)}"
Rubric for this turn: ${rubric}
Score 1-5 against the rubric. Brevity is GOOD for a spoken reply — only penalize what the rubric targets, nonsense, contradictions, or ignoring the user.
Return JSON {"score": number, "reason": "one short line"}.`,
	)
	const score = typeof parsed.score === "number" ? parsed.score : 0
	const reason = typeof parsed.reason === "string" ? parsed.reason : "unparsed"
	return { score, reason }
}

const askWinner = async (
	question: string,
	replyA: string,
	replyB: string,
	rubric: string,
): Promise<string> => {
	const parsed = await generateJson(
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
	const first = await askWinner(question, replyA, replyB, rubric)
	const swapped = await askWinner(question, replyB, replyA, rubric)
	if (first === "A" && swapped === "B") return "A"
	if (first === "B" && swapped === "A") return "B"
	return "tie"
}

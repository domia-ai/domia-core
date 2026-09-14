import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import {
	evalCaseFileSchema,
	judgeConversation,
	judgePanelSpecs,
	makeChecker,
} from "./lib"
import type {
	EvalCaseType,
	JudgeStabilityRepeatType,
	JudgeStabilityResultType,
	StoredTranscriptType,
} from "./types"

const RESULTS_DIR = join(process.cwd(), "evals", "bench-results")
const CASES_DIR = join(process.cwd(), "evals", "cases")
const TRANSCRIPT_COUNT = 3
const REPEATS = 3
const MIN_TURNS = 5

const loadCases = (): EvalCaseType[] => {
	const cases: EvalCaseType[] = []
	for (const file of readdirSync(CASES_DIR).filter((f) =>
		f.endsWith(".json"),
	)) {
		const parsed = evalCaseFileSchema.safeParse(
			JSON.parse(readFileSync(join(CASES_DIR, file), "utf8")) as unknown,
		)
		if (parsed.success) cases.push(...parsed.data)
	}
	return cases
}

const rubricFor = (caseName: string, cases: EvalCaseType[]): string | null =>
	cases.find((c) => c.name === caseName)?.conversation?.judge?.rubric ?? null

const readTranscript = (
	file: string,
	cases: EvalCaseType[],
): StoredTranscriptType | null => {
	const raw = JSON.parse(readFileSync(join(RESULTS_DIR, file), "utf8")) as {
		case?: unknown
		judge?: { score?: unknown }
		turns?: unknown
	}
	const caseName = typeof raw.case === "string" ? raw.case : ""
	const rubric = rubricFor(caseName, cases)
	if (!rubric) return null
	const turns = Array.isArray(raw.turns)
		? raw.turns
				.filter(
					(t): t is { user: string; reply: string } =>
						t !== null &&
						typeof t === "object" &&
						typeof (t as { user?: unknown }).user === "string" &&
						typeof (t as { reply?: unknown }).reply === "string",
				)
				.map((t) => ({ user: t.user, reply: t.reply }))
		: []
	if (turns.length < MIN_TURNS) return null
	return {
		file,
		caseName,
		rubric,
		turns,
		storedScore: typeof raw.judge?.score === "number" ? raw.judge.score : null,
	}
}

const newestTranscripts = (): StoredTranscriptType[] => {
	const cases = loadCases()
	const files = readdirSync(RESULTS_DIR)
		.filter((f) => f.startsWith("conversation-long-") && f.endsWith(".json"))
		.map((f) => ({ f, at: statSync(join(RESULTS_DIR, f)).mtimeMs }))
		.sort((a, b) => b.at - a.at)
		.map((x) => x.f)
	const found: StoredTranscriptType[] = []
	for (const file of files) {
		if (found.length === TRANSCRIPT_COUNT) break
		const transcript = readTranscript(file, cases)
		if (transcript) found.push(transcript)
	}
	return found
}

const spread = (xs: number[]): number =>
	xs.length ? Math.max(...xs) - Math.min(...xs) : 0

const mean = (xs: number[]): number =>
	xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0

const measure = async (
	transcript: StoredTranscriptType,
): Promise<JudgeStabilityResultType> => {
	const repeats: JudgeStabilityRepeatType[] = []
	for (let i = 0; i < REPEATS; i++) {
		const verdict = await judgeConversation(transcript.turns, transcript.rubric)
		repeats.push({
			median: verdict.score,
			agreement: verdict.agreement,
			panel: verdict.panel,
		})
		console.log(
			`    repeat ${i + 1}: median ${verdict.score} · agreement ${verdict.agreement.toFixed(2)} · ${verdict.panel
				.map((m) => `${m.judge}=${m.score}[${m.positionScores.join("/")}]`)
				.join(" ")}`,
		)
	}
	return { transcript, repeats }
}

const report = (result: JudgeStabilityResultType): number[] => {
	const medians = result.repeats.map((r) => r.median)
	for (const judge of result.repeats[0]?.panel.map((m) => m.judge) ?? []) {
		const scores = result.repeats.map(
			(r) => r.panel.find((m) => m.judge === judge)?.score ?? 0,
		)
		const positions = result.repeats.flatMap(
			(r) => r.panel.find((m) => m.judge === judge)?.positionScores ?? [],
		)
		console.log(
			`    ${judge}: repeats ${scores.join(", ")} · repetition spread ${spread(scores).toFixed(2)} · position spread ${spread(positions).toFixed(2)}`,
		)
	}
	console.log(
		`    cross-judge agreement mean ${mean(result.repeats.map((r) => r.agreement)).toFixed(2)} · medians ${medians.join(", ")}`,
	)
	return medians
}

const main = async (): Promise<void> => {
	const specs = judgePanelSpecs()
	console.log(
		`=== evals:judge-stability — panel: ${specs.map((s) => s.label).join(", ")} ===`,
	)
	if (specs.length === 1)
		console.log(
			"⚠️ single-judge panel — set EVAL_JUDGE_MODELS to a comma list of families to measure cross-judge agreement",
		)
	const transcripts = newestTranscripts()
	if (transcripts.length < TRANSCRIPT_COUNT) {
		console.error(
			`❌ need ${TRANSCRIPT_COUNT} stored transcripts in evals/bench-results — found ${transcripts.length}. Run "npm run evals -- conversation-30" first.`,
		)
		process.exit(2)
	}
	const checker = makeChecker()
	for (const transcript of transcripts) {
		console.log(
			`\n  ${transcript.file} (${transcript.turns.length} turns, stored score ${transcript.storedScore ?? "n/a"})`,
		)
		const result = await measure(transcript)
		const medians = report(result)
		const rounded = medians.map((m) => Math.round(m))
		checker.check(
			`${transcript.file} median stable across ${REPEATS} repeats`,
			rounded.every((m) => m === rounded[0]) && rounded[0] > 0,
			`medians ${medians.join(", ")}`,
		)
	}
	console.log(
		`\njudge-stability: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	process.exit(checker.failCount() === 0 ? 0 : 1)
}

void main()

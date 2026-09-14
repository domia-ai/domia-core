import { percentile } from "./stats"
import type {
	ConversationLatencyType,
	ConversationMetricsType,
	ConversationTurnResultType,
	EvalAssertionType,
} from "../types"

const TOOL_ASSERTION_RE =
	/^(tools=|tool=|notTools$|noTools$|noWrites$|compound=|calledToolCount=|exactlyOnce:|traceStatus\[|toolResultStatus|fastPath=|routed=|finalizeMode=|stopReason=|argsSubset$|argMatch:|anyArgMatches)/

const INSTRUCTION_ASSERTION_RE =
	/^(replyMatches|replyNotMatches|replyNotQuestion$|maxReplyWords|replyIncludes:|replyExcludes:|noRepeat$|noEcho$|judge>=)/

const KB_ASSERTION_RE =
	/^(promptSection\[WHAT YOU KNOW|recallsFact:|promptIncludes:|factInDb:)/

const RETENTION_ASSERTION_RE = /^(promptSection\[RECENT TURNS\]|recallsFact:)/

const rate = (assertions: EvalAssertionType[]): number | null =>
	assertions.length === 0
		? null
		: assertions.filter((a) => a.ok).length / assertions.length

const pick = (
	turns: ConversationTurnResultType[],
	re: RegExp,
): EvalAssertionType[] =>
	turns.flatMap((t) => t.assertions.filter((a) => re.test(a.name)))

const isRetentionTurn = (turn: ConversationTurnResultType): boolean =>
	turn.anaphora ||
	turn.assertions.some((a) => RETENTION_ASSERTION_RE.test(a.name))

const latency = (values: (number | null)[]): ConversationLatencyType => {
	const xs = values.filter((v): v is number => typeof v === "number" && v > 0)
	return {
		n: xs.length,
		p50: xs.length ? percentile(xs, 50) : null,
		p95: xs.length ? percentile(xs, 95) : null,
	}
}

export const conversationMetrics = (
	turns: ConversationTurnResultType[],
): ConversationMetricsType => {
	const records = turns.map((t) => t.record)
	const retentionTurns = turns.filter(isRetentionTurn)
	return {
		turnsRun: turns.length,
		turnPassRate: turns.length
			? turns.filter((t) => t.passed).length / turns.length
			: 0,
		toolCorrectness: rate(pick(turns, TOOL_ASSERTION_RE)),
		instructionFollowing: rate(pick(turns, INSTRUCTION_ASSERTION_RE)),
		kbGrounding: rate(pick(turns, KB_ASSERTION_RE)),
		contextRetention: rate(retentionTurns.flatMap((t) => t.assertions)),
		ttftMs: latency(records.map((r) => r?.llmTtftMs ?? null)),
		ttfaMs: latency(records.map((r) => r?.ttfaMs ?? null)),
		perceivedTtfaMs: latency(records.map((r) => r?.perceivedTtfaMs ?? null)),
		eouDelayP50: latency(records.map((r) => r?.eouDelayMs ?? null)).p50,
	}
}

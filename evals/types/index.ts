export type EvalSuiteType =
	| "home"
	| "home-live"
	| "chat"
	| "fast"
	| "memory"
	| "parsing"

export type EvalExpectType = {
	routed?: "skill" | "chat" | "fast"
	tool?: string
	notTools?: string[]
	argsSubset?: Record<string, unknown>
	argMatchers?: Record<string, string>
	replyIncludes?: string[]
	maxTtfaMs?: number
	status?: "ok"
	expectEvents?: {
		present?: string[]
		toolResultStatus?: "ok" | "failed" | "timeout" | "cancelled"
		completedAfterPlayback?: boolean
		seqOrdered?: boolean
	}
}

export type EvalTurnType = {
	text: string
	expect: EvalExpectType
}

export type EvalCaseType = {
	name: string
	suite: EvalSuiteType
	language: "en" | "es"
	runs?: number
	passRatio?: number
	turns: EvalTurnType[]
}

export type EvalTurnRecordType = {
	interactionId: string
	reply: string
	intentDecision: string | null
	toolCallCount: number | null
	llmMs: number | null
	ttfaMs: number | null
	status: string | null
	skillResponse: unknown[] | null
	events: { type: string; seq: number }[]
}

export type EvalAssertionType = { name: string; ok: boolean; detail?: string }

export type EvalCaseResultType = {
	name: string
	suite: EvalSuiteType
	passed: boolean
	runsPassed: number
	runs: number
	assertions: EvalAssertionType[]
}

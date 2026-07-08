export type EvalSuiteType =
	| "home-mock"
	| "home-live"
	| "chat"
	| "fast"
	| "memory"
	| "parsing"

export type EvalRequirementType = "skills" | "ha" | "facts" | "multilingual"

export type EvalExpectType = {
	routed?: "skill" | "chat" | "fast"
	tool?: string | string[]
	notTools?: string[]
	argsSubset?: Record<string, unknown>
	argMatchers?: Record<string, string>
	anyArgMatches?: string
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

export type EvalCaseModeType = "gate" | "advisory"

export type EvalCaseType = {
	name: string
	suite: EvalSuiteType
	language: "en" | "es"
	runs?: number
	passRatio?: number
	mode?: EvalCaseModeType
	isolate?: "facts"
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
	events: { type: string; seq: number; payload: string | null }[]
}

export type EvalAssertionType = { name: string; ok: boolean; detail?: string }

export type EvalRunDetailType = {
	run: number
	passed: boolean
	interactionIds: string[]
	assertions: EvalAssertionType[]
}

export type EvalCaseResultType = {
	name: string
	suite: EvalSuiteType
	mode: EvalCaseModeType
	passed: boolean
	runsPassed: number
	runs: number
	runsDetail: EvalRunDetailType[]
}

export type LadderRowType = { type: string; payload: string }

export type SatelliteTurnOptionsType = {
	disconnectAfterSpeechEnd?: boolean
	token?: string
	wsUrl?: string
}

export type SatelliteTurnResultType = {
	ready: boolean
	transcript: string | null
	audioBegan: boolean
	audioFrames: number
	audioEnded: boolean
	replyDone: { reply: string; interactionId: string } | null
	error: string | null
}

export type ParsedWavType = {
	pcm: Buffer
	sampleRate: number
	channels: number
}

export type BenchStatsType = {
	p50: number
	p95: number
	min: number
	max: number
}

export type BenchSummaryType = {
	label: string
	n: number
	expected: number
	failed: number
	transcriptMismatches: number
	runs: number
	snapshot: Record<string, string>
	all: Record<string, BenchStatsType>
	warm?: Record<string, BenchStatsType>
}

export type MockHaServerType = {
	url: string
	close: () => Promise<void>
}

export type CheckerType = {
	check: (name: string, cond: boolean, detail?: string) => void
	passCount: () => number
	failCount: () => number
}

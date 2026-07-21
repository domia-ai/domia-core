export type EvalSuiteType =
	| "home-mock"
	| "home-live"
	| "chat"
	| "fast"
	| "memory"
	| "conversation"
	| "parsing"

export type EvalRequirementType = "skills" | "ha" | "facts" | "multilingual"

export type PromptSectionType =
	| "WHAT YOU KNOW"
	| "WHAT YOU KNOW ABOUT HERE"
	| "RECENT TURNS"
	| "WHO YOU'RE TALKING TO"
	| "PREVIOUSLY"

export type EvalExpectType = {
	routed?: "skill" | "chat" | "fast"
	tool?: string | string[]
	notTools?: string[]
	argsSubset?: Record<string, unknown>
	argMatchers?: Record<string, string>
	anyArgMatches?: string
	replyIncludes?: string[]
	replyExcludes?: string[]
	noRepeat?: boolean
	noEcho?: boolean
	maxTtfaMs?: number
	status?: "ok"
	promptIncludes?: string[]
	promptSection?: { section: PromptSectionType; includes: string[] }
	recallsFact?: { subject?: string; value: string }
	factInDb?: { subject?: string; value: string }
	noFactInDb?: { subject?: string; value: string }
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
	isolate?: "facts" | "conversation" | "session"
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
	llmPrompt: string | null
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
	pauses: number
	resumes: number
	replyDone: { reply: string; interactionId: string } | null
	error: string | null
}

export type PromotionCandidateType = {
	interactionId: string
	utterance: string
	signal: string
	at: string
}

export type AttackRowType = {
	name: string
	type: string
	text: string
}

export type ChatResponseType = {
	interactionId: string
	reply: string
	transcript?: string
}

export type ReplayEventType = {
	type: string
	data: Record<string, unknown>
	payloadBytes: number
}

export type ReplaySocketType = {
	socket: import("net").Socket
	feed: (chunk: Buffer) => void
	written: () => Buffer
	isDestroyed: () => boolean
}

export type RealtimeTurnOptionsType = {
	serverVad?: boolean
	wsUrl?: string
}

export type RealtimeTurnResultType = {
	sessionCreated: boolean
	speechStopped: boolean
	transcript: string | null
	responseCreated: boolean
	audioDeltas: number
	audioDone: boolean
	replyText: string | null
	responseDone: boolean
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

export type FakeAudioSegmentKindType = "speech" | "silence"

export type FakeAudioSegmentType = {
	kind: FakeAudioSegmentKindType
	ms: number
}

export type FakeAudioScriptType = {
	segments: FakeAudioSegmentType[]
	sampleRate?: number
	speedFactor?: number
	chunkMs?: number
}

export type FakeAudioTickType = {
	elapsedMs: number
	kind: FakeAudioSegmentKindType
}

export type VadTickSampleType = FakeAudioTickType & {
	speechActive: boolean
	everDetected: boolean
	completed: boolean
}

export type EvalSuiteType =
	| "home-mock"
	| "home-live"
	| "chat"
	| "fast"
	| "routing"
	| "memory"
	| "conversation"
	| "parsing"
	| "tools"
	| "tools-confirm"
	| "security"

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
	maxReplyWords?: number
	judge?: { rubric: string; min: number }
	maxTtfaMs?: number
	status?: "ok"
	promptIncludes?: string[]
	promptSection?: { section: PromptSectionType; includes: string[] }
	recallsFact?: { subject?: string; value: string }
	factInDb?: { subject?: string; value: string }
	noFactInDb?: { subject?: string; value: string }
	factCountAtMost?: { subject?: string; value: string; count: number }
	fastPath?: boolean
	calledToolCount?: number
	traceToolStatus?: Record<string, string>
	exactlyOnce?: string
	stageOrder?: string[]
	maxDecisionMs?: number
	maxToolMs?: number
	maxFinalizeMs?: number
	expectFinalizeMode?: string
	expectStopReason?: string
	expectEvents?: {
		present?: string[]
		toolResultStatus?: "ok" | "failed" | "timeout" | "cancelled"
		toolResultStatusFor?: Record<
			string,
			"ok" | "failed" | "timeout" | "cancelled"
		>
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
	seedFacts?: SeedFactType[]
	mockHa?: Partial<MockHaBehaviorType>
	turns: EvalTurnType[]
}

export type EvalTurnRecordType = {
	interactionId: string
	reply: string
	intentDecision: string | null
	toolCallCount: number | null
	llmMs: number | null
	ttfaMs: number | null
	agentDecisionMs: number | null
	agentToolMs: number | null
	agentFinalizeMs: number | null
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
	bargeIn?: {
		afterFrames?: number
		speechMs: number
		thenSilenceMs?: number
	}
	echoLoopback?: boolean
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
	ladderViolations: number
	runs: number
	snapshot: Record<string, string>
	runtime: RuntimeSnapshotType
	all: Record<string, BenchStatsType>
	warm?: Record<string, BenchStatsType>
}

export type RuntimeSnapshotType = {
	node: string
	platform: string
	cpu: string
	cores: number
	totalMemGb: number
	hostname: string
	hardwareLabel: string
	gitCommit: string
	gitDirty: boolean
	sherpaOnnxNode: string
	evalUrl: string
	evalDb: string
	evalDomiaKey: string
	capturedAt: string
}

export type LadderDeltasType = Record<string, number | null>

export type EndpointAckStatsType = {
	ackCount: number
	beforeSttFinal: boolean | null
}

export type FactDedupPairType = {
	relation: string
	a: string
	b: string
	duplicate: boolean
}

export type TtsTournamentCandidateType = {
	label: string
	config: Record<string, unknown>
	generation: () => { speed: number } & Record<string, unknown>
}

export type TtsTournamentRowType = {
	candidate: string
	textClass: string
	loadMs: number
	wallMsP50: number
	wallMsMax: number
	audioSec: number
	rtf: number
	wer: number
	rssAfterMb: number
}

export type MockHaBehaviorType = {
	latencyMs: Record<string, number>
	fail: Record<string, number | "always">
	poison: Record<string, string>
	annotations: boolean
	catalogSize: number
}

export type MockHaServerType = {
	url: string
	setBehavior: (patch: Partial<MockHaBehaviorType>) => Promise<void>
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

export type SyncFactType = { id: string; value: string; updatedAt: string }

export type SyncPageType = {
	facts: SyncFactType[]
	nextFactsCursor: { since: string; id: string } | null
}

export type EsphomeSentEventType = {
	type: number
	data?: { name: string; value: string }[]
}

export type FakeEsphomeCallType = { method: string; args: unknown[] }

export type FakeEsphomeDeviceType = {
	module: typeof import("esphome-client")
	calls: FakeEsphomeCallType[]
	callsOf: (method: string) => FakeEsphomeCallType[]
	sentEventTypes: () => number[]
	emit: (name: string, payload?: unknown) => void
	setEntities: (list: Record<string, unknown>[]) => void
}

export type PauseCorpusCaseType = {
	id: string
	baseId: string
	text: string
	trapMs: number
	file: string
	cutFile: string
}

export type PauseCorpusManifestType = {
	note: string
	cases: PauseCorpusCaseType[]
	controls: { id: string; file: string }[]
}

export type SeedFactType = { subject: string; relation: string; value: string }

export type JudgeVerdictType = { score: number; reason: string }

export type PairwiseWinnerType = "A" | "B" | "tie"

export type TourneyCaseResultType = {
	name: string
	passed: boolean
}

export type TourneyTurnReplyType = {
	caseName: string
	turnIndex: number
	user: string
	reply: string
}

export type TourneyModelResultType = {
	model: string
	casesPassed: number
	casesTotal: number
	cases: TourneyCaseResultType[]
	ttftP50Ms: number | null
	tokensPerSecP50: number | null
	llmMsP50: number | null
	pairwise: { wins: number; losses: number; ties: number }
	transcript: string
}

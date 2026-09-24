import type { FastPathBlockType, FastPathSlotType, ToolPolicyType } from "@/db"
import type { FastPathAstNodeType } from "@/modules/fast-path/types"
import type {
	MindIdentityRefType,
	MindSectionsType,
} from "@/modules/mind-transfer"

export type EvalSuiteType =
	| "home-mock"
	| "home-live"
	| "chat"
	| "fast"
	| "routing"
	| "memory"
	| "conversation"
	| "conversation-long"
	| "parsing"
	| "tools"
	| "tools-confirm"
	| "security"
	| "tool-scenarios"

export type EvalRequirementType =
	| "skills"
	| "ha"
	| "music"
	| "facts"
	| "multilingual"

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
	tools?: string[]
	toolsNamespaced?: string[]
	mockMusicState?: EvalMockMusicStateType
	noTools?: boolean
	noWrites?: boolean
	compound?: number
	replyNotQuestion?: boolean
	replyMatches?: string
	replyNotMatches?: string
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

export type EvalMockMusicStateType = {
	player: string
	state?: "idle" | "playing" | "paused"
	volumeLevel?: number
	muted?: boolean
	currentItemMatches?: string
}

export type EvalOnReplyWhenType = {
	toolCalled?: string
	notToolCalled?: string
	replyMatches?: string
	routed?: "skill" | "chat" | "fast"
	traceToolStatus?: Record<string, string>
}

export type EvalOnReplyRuleType = {
	when: EvalOnReplyWhenType
	next: string
}

export type EvalTurnType = {
	id?: string
	name?: string
	gate?: boolean
	text: string
	satelliteId?: string
	mockHa?: EvalCaseMockHaType
	onReply?: EvalOnReplyRuleType[]
	end?: boolean
	expect: EvalExpectType
}

export type EvalCaseModeType = "gate" | "advisory"

export type EvalCaseMockHaType = Partial<MockHaBehaviorType> & {
	stateful?: boolean
}

export type EvalCaseMockMusicType = Partial<MockMusicBehaviorType> & {
	stateful?: boolean
}

export type ConversationThresholdsType = {
	judge?: { rubric: string; min: number }
	minTurnPassRate?: number
	ttftP50MaxMs?: number
	ttfaP50MaxMs?: number
	perceivedTtfaP50MaxMs?: number
	minToolCorrectness?: number
	minInstructionFollowing?: number
	minContextRetention?: number
}

export type EvalCaseType = {
	name: string
	suite: EvalSuiteType
	language: string
	runs?: number
	passRatio?: number
	mode?: EvalCaseModeType
	isolate?: "facts" | "conversation" | "session"
	seedFacts?: SeedFactType[]
	mockHa?: EvalCaseMockHaType
	mockMusic?: EvalCaseMockMusicType
	site?: string
	entities?: Record<string, string>
	conversation?: ConversationThresholdsType
	turns: EvalTurnType[]
}

export type SiteEntityType = {
	name: string
	entityId: string
	area: string
	token: string
	spoken: string
	spokenSingular?: string
	nameEs?: string
}

export type SiteSpeakerType = {
	name: string
	playerId: string
	spoken: string
	nameEs?: string
}

export type SiteMapType = {
	name: string
	entities: Record<string, SiteEntityType>
	speakers?: Record<string, SiteSpeakerType>
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
	perceivedTtfaMs: number | null
	eouDelayMs: number | null
	endpointDebounceMs: number | null
	implicitFeedback: string | null
	llmTtftMs: number | null
	llmFirstSentenceMs: number | null
	heardReply: string | null
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

export type MockBehaviorCoreType = {
	latencyMs: Record<string, number>
	fail: Record<string, number | "always">
	poison: Record<string, string>
}

export type MockBehaviorGateType = {
	check: (tool: string) => Promise<string | null>
	poisonOf: (tool: string) => string | undefined
	resetCounts: () => void
}

export type MockHaBehaviorType = MockBehaviorCoreType & {
	annotations: boolean
	catalogSize: number
	domainPrefixed: boolean
}

export type MockHaServerType = {
	url: string
	setBehavior: (patch: Partial<MockHaBehaviorType>) => Promise<void>
	close: () => Promise<void>
}

export type MockMusicBehaviorType = MockBehaviorCoreType

export type MockMusicTrackType = {
	uri: string
	name: string
	artists: string[]
	album: string
	duration: number
}

export type MockMusicQueueItemType = {
	item_id: string
	name: string
	index: number
	duration: number
	artists: string[]
}

export type MockMusicQueueType = {
	queue_id: string
	current_index: number
	item_count: number
	items: MockMusicQueueItemType[]
	shuffle: boolean
	repeat: "off" | "one" | "all"
}

export type MockMusicCurrentItemType = {
	item_id: string
	name: string
	artists: string[]
	album: string
	duration: number
	uri: string
}

export type MockMusicPlayerType = {
	player_id: string
	name: string
	state: "idle" | "playing" | "paused"
	volume_level: number
	volume_muted: boolean
	powered: boolean
	available: boolean
	current_item: MockMusicCurrentItemType | null
	active_group: string | null
	synced_to: string | null
}

export type MockMusicStateType = {
	players: MockMusicPlayerType[]
	queues: MockMusicQueueType[]
}

export type MockMusicServerType = {
	url: string
	setBehavior: (patch: Partial<MockMusicBehaviorType>) => Promise<void>
	reset: () => Promise<void>
	state: () => Promise<MockMusicStateType>
	close: () => Promise<void>
}

export type MockMcpServerType = {
	url: string
	close: () => Promise<void>
}

export type MockDualEraServerType = {
	url: string
	ttlMs: number
	close: () => Promise<void>
}

export type MockProvidersControlType = {
	teardown: () => Promise<void>
	ha: {
		setBehavior: (patch: Record<string, unknown>) => Promise<void>
		resync: () => Promise<void>
	} | null
	music: {
		setBehavior: (patch: Record<string, unknown>) => Promise<void>
		reset: () => Promise<void>
		state: () => Promise<MockMusicStateType>
	} | null
}

export type ToolScenarioRowType = {
	intent_decision: string | null
	tool_call_count: number | null
	skill_response: string | null
	llm_response: string | null
	status: string | null
	llm_ms: number | null
	total_ms: number | null
}

export type ToolScenarioToolEntryType = {
	kind?: string
	tool?: string
	status?: string
	resolvedArgs?: Record<string, unknown>
	args?: Record<string, unknown>
}

export type ToolScenarioResultType = {
	name: string
	text: string
	gate: boolean
	pass: boolean
	detail: string
	reply: string
	tools: string[]
	intent: string | null
	totalMs: number | null
}

export type VirtualClockType = {
	now: () => number
	sleep: (ms: number) => Promise<void>
	elapsed: () => number
}

export type ReflectionGateScenarioType = {
	name: string
	busyAt: (t: number) => boolean
	settingsPatch?: Partial<{
		onlyWhenIdle: boolean
		maxIdleWaitMs: number
		idleGraceMs: number
		idlePollMs: number
	}>
	expectRan: boolean
	minElapsedMs: number
	maxElapsedMs: number
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

export type SyncStreamCursorType = { since: string; id: string }

export type SyncToolRunType = {
	id: string
	createdAt: string
	routineSlug: string | null
	stepIndex: number | null
}

export type SyncEpisodeType = { id: string; createdAt: string }

export type SyncKeysetRowType = { id: string }

export type SyncStreamsPageType = {
	toolRuns: SyncToolRunType[]
	memoryEpisodes: SyncEpisodeType[]
	knowledgeEntries: SyncKeysetRowType[]
	voiceFeelAdjustments: SyncKeysetRowType[]
	factEvidence: SyncKeysetRowType[]
	userModel: Record<string, unknown> | null
	nextToolCursor: SyncStreamCursorType | null
	nextEpisodeCursor: SyncStreamCursorType | null
	nextKnowledgeCursor: SyncStreamCursorType | null
	nextVoiceFeelCursor: SyncStreamCursorType | null
	nextEvidenceCursor: SyncStreamCursorType | null
}

export type SyncKeysetStreamType = {
	name: string
	rows: (page: SyncStreamsPageType) => SyncKeysetRowType[]
	next: (page: SyncStreamsPageType) => SyncStreamCursorType | null
	params: (cursor: SyncStreamCursorType) => Record<string, string>
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

export type JudgeEngineType = "ollama" | "openai"

export type JudgeSpecType = {
	engine: JudgeEngineType
	model: string
	label: string
}

export type JudgePanelMemberType = {
	judge: string
	score: number
	reason: string
	positionScores: number[]
}

export type JudgeVerdictType = {
	score: number
	reason: string
	agreement: number
	panel: JudgePanelMemberType[]
}

export type ConversationJudgeVerdictType = JudgeVerdictType & {
	issues: string[]
}

export type StoredTranscriptType = {
	file: string
	caseName: string
	rubric: string
	turns: { user: string; reply: string }[]
	storedScore: number | null
}

export type JudgeStabilityRepeatType = {
	median: number
	agreement: number
	panel: JudgePanelMemberType[]
}

export type JudgeStabilityResultType = {
	transcript: StoredTranscriptType
	repeats: JudgeStabilityRepeatType[]
}

export type ConversationTurnResultType = {
	step: number
	id: string
	name: string
	user: string
	reply: string
	passed: boolean
	anaphora: boolean
	tools: string[]
	intent: string | null
	assertions: EvalAssertionType[]
	record: EvalTurnRecordType | null
	nextId: string | null
}

export type ConversationLatencyType = {
	n: number
	p50: number | null
	p95: number | null
}

export type ConversationMetricsType = {
	turnsRun: number
	turnPassRate: number
	toolCorrectness: number | null
	instructionFollowing: number | null
	kbGrounding: number | null
	contextRetention: number | null
	ttftMs: ConversationLatencyType
	ttfaMs: ConversationLatencyType
	perceivedTtfaMs: ConversationLatencyType
	eouDelayP50: number | null
}

export type ConversationGateType = {
	name: string
	ok: boolean
	detail: string
}

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

export type EvalBatteryType =
	| "pure"
	| "node"
	| "tool"
	| "quality"
	| "hardware"
	| "utility"

export type EvalRegistrySuiteType = {
	name: string
	file: string
	battery: EvalBatteryType
	env?: Record<string, string>
	requires?: EvalRequirementType[]
	description: string
}

export type EvalRequirementGateType = {
	requirement: EvalRequirementType
	reason: string
	recovery: string
}

export type FakeWyomingEventType = {
	type: string
	data: Record<string, unknown>
	payload: Buffer | null
	at: number
}

export type FakeWyomingSatelliteType = {
	port: number
	events: FakeWyomingEventType[]
	eventsOf: (type: string) => FakeWyomingEventType[]
	waitFor: (
		type: string,
		count?: number,
		timeoutMs?: number,
	) => Promise<boolean>
	send: (type: string, data?: Record<string, unknown>, payload?: Buffer) => void
	close: () => void
}

export type TurnTagExpectType = "complete" | "short" | "long"

export type TurnTagObservedType = TurnTagExpectType | "untagged"

export type TurnTagCorpusItemType = {
	id: string
	text: string
	language: string
	expect: TurnTagExpectType
}

export type TurnTagCorpusType = {
	version: number
	marks: Record<TurnTagExpectType, string>
	items: TurnTagCorpusItemType[]
}

export type TurnTagSampleType = {
	item: TurnTagCorpusItemType
	got: TurnTagObservedType
	firstChar: string
}

export type SttDenoiseCorpusType = {
	cases: { id: string; text: string }[]
}

export type SttDenoiseManifestType = Record<
	string,
	{ cls: string; file: string }[]
>

export type SubsystemOutcomeType = {
	subsystem: string
	status: string
	error?: string
}

export type ApplyResponseType = {
	config?: Record<string, unknown>
	apply?: {
		result: string
		revertedSections: string[]
		subsystems: SubsystemOutcomeType[]
	}
}

export type ConfigApplyProbeCaseType = {
	label: string
	section: "stt" | "tts" | "llm"
	subsystem: string
	patch: Record<string, unknown>
}

export type MockEntityStateType = { on: boolean; brightness: number | null }

export type DumpFileType = {
	version: "mind-dump-2"
	db: string
	dumpedAt: string
	domias: MindIdentityRefType[]
	tables: MindSectionsType
}

export type GrammarProbeCaseType = {
	name: string
	text: string
	expect: "calls" | "text"
	tools?: string[]
	minHits: number
}

export type ToolGrammarParserCaseType = {
	name: string
	input: string
	expect: "tool_calls" | "reply" | "unparseable"
	calls?: string[]
	reply?: string
	args?: Record<string, unknown>
}

export type HaIntentScopeType = "action" | "read" | "builtin" | "excluded"

export type HaExpectedArgValueType = string | number | string[]

export type HaExpectedCallType = {
	tool: string | null
	args: Record<string, HaExpectedArgValueType>
}

export type HaSlotComparisonType = {
	ok: boolean
	missing: string[]
	mismatched: string[]
	extra: string[]
}

export type HaIntentsMetaType = {
	source: string
	commit: string
	license: string
	generatedBy: string
}

export type HaIntentsRowType = {
	id: string
	language: string
	intent: string
	combination: string
	text: string
	scope: HaIntentScopeType
	contextArea: boolean
	entityDomain: string | null
	expect: HaExpectedCallType
}

export type HaIntentsRowsFileType = {
	meta: HaIntentsMetaType
	rows: HaIntentsRowType[]
}

export type HaIntentsEntityType = {
	name: string
	domain: string
	area: string | null
	floor: string | null
	deviceClass: string | null
	state: string | null
}

export type HaIntentsSiteType = {
	language: string
	floors: string[]
	areas: string[]
	entities: HaIntentsEntityType[]
}

export type HaIntentsSiteFileType = HaIntentsSiteType & {
	meta: HaIntentsMetaType
}

export type HaIntentsTemplateBlockType = {
	intent: string
	combination: string
	templates: string[]
	nameDomains: string | string[] | null
	inferredDomain: string | null
	speechToPhrase: boolean
	contextArea: boolean
}

export type HaIntentsTemplatesType = {
	language: string
	rules: Record<string, string>
	lists: string[]
	blocks: HaIntentsTemplateBlockType[]
}

export type HaIntentsTemplatesFileType = HaIntentsTemplatesType & {
	meta: HaIntentsMetaType
}

export type HaIntentsBaselineEntryType = {
	matchedCorrect: number
	wrong: number
	falsePositives: number
}

export type HaIntentsBaselineType = Record<string, HaIntentsBaselineEntryType>

export type HaMcpPropertyType =
	| { type: "string" }
	| { type: "number" }
	| { type: "array"; items: { type: "string" } }

export type HaMcpToolSpecType = {
	rawName: string
	domain: string
	description: string
	properties: Record<string, HaMcpPropertyType>
}

export type MockHaEntityType = {
	names: string[]
	domain: string
	area: string
}

export type MockHaSiteType = {
	entities: MockHaEntityType[]
	tools?: HaMcpToolSpecType[]
}

export type HaSweepMissCountsType = {
	noTemplates: number
	noMatch: number
	tooLong: number
	blockedToken: number
	ambiguous: number
}

export type HaSweepActionCountsType = {
	total: number
	matchedCorrect: number
	extraArgs: number
	matchedWrongTool: number
	matchedWrongSlots: number
	compound: number
	houseWide: number
	miss: HaSweepMissCountsType
}

export type HaSweepIntentReportType = HaSweepActionCountsType & {
	scope: HaIntentScopeType
	falsePositives: number
	byCombination: Record<string, HaSweepActionCountsType>
}

export type HaSweepNegativesType = {
	read: {
		total: number
		miss: number
		matchedRead: number
		matchedWrite: number
	}
	builtin: { total: number; matched: number }
	excluded: { total: number; matched: number }
}

export type HaSweepSampleType = {
	text: string
	expected: string
	got: string
}

export type HaSweepSampleBucketType =
	| "matchedWrongTool"
	| "matchedWrongSlots"
	| "compound"
	| "houseWide"
	| "falsePositive"

export type HaSweepTemplateCompatType = {
	blocks: number
	speechToPhraseBlocks: number
	templates: number
	compatible: number
	rejected: {
		wildcard: number
		permutation: number
		noLiteral: number
		slotInOptional: number
		unknownRule: number
		bareAlternation: number
		other: number
	}
}

export type HaSweepLanguageReportType = {
	language: string
	sentences: Record<HaIntentScopeType, number>
	actions: HaSweepActionCountsType
	negatives: HaSweepNegativesType
	byIntent: Record<string, HaSweepIntentReportType>
	blockers: Record<string, number>
	samples: Record<HaSweepSampleBucketType, HaSweepSampleType[]>
	fastPathMs: { p50: number; p95: number }
	templates: HaSweepTemplateCompatType
	slotValues: { entities: number; areas: number }
}

export type HaSweepRowVerdictType =
	| { bucket: "matchedCorrect"; extraArgs: boolean }
	| { bucket: "matchedWrongTool"; got: string }
	| { bucket: "matchedWrongSlots"; got: string }
	| { bucket: "compound"; got: string }
	| { bucket: "houseWide"; got: string }
	| { bucket: "miss"; reason: keyof HaSweepMissCountsType; blocker?: string }
	| {
			bucket: "falsePositive"
			got: string
			read: "matchedRead" | "matchedWrite" | null
	  }
	| { bucket: "expectedMiss" }
	| { bucket: "fatal"; reason: string }

export type MockDescriptorMcpServerType = {
	url: string
	setDescriptor: (text: string | null) => void
	close: () => Promise<void>
}

export type HassilNodeType =
	| { kind: "text"; value: string }
	| { kind: "slot"; list: string; arg: string }
	| { kind: "rule"; name: string }
	| { kind: "optional"; body: HassilNodeType[] }
	| { kind: "group"; alternatives: HassilNodeType[][] }

export type HaDescriptorNodeType =
	| { kind: "text"; value: string }
	| { kind: "slot"; name: string }
	| { kind: "rule"; name: string }
	| { kind: "optional"; body: HaDescriptorNodeType[] }
	| { kind: "group"; alternatives: HaDescriptorNodeType[][] }

export type HaCorpusListType =
	| { kind: "range"; min: number; max: number }
	| { kind: "values"; values: { in: string; out: unknown }[] }

export type HaCorpusSentenceBlockType = {
	intent: string
	combination: string
	index: number
	sentences: string[]
	nameDomains: string | string[] | null
	inferredDomain: string | null
	speechToPhrase: boolean
}

export type HaCorpusCombinationType = {
	slots: string[]
	contextArea: boolean
	nameDomains: string[]
}

export type HaDescriptorTemplateDropReasonType =
	| "noLiteral"
	| "parseError"
	| "lintError"
	| "unknownList"
	| "unknownRule"
	| "permutationTooLarge"
	| "expansionTooLarge"
	| "slotGlued"
	| "noTargetSlot"
	| "duplicate"

export type HaDescriptorBlockSkipReasonType =
	| "speechToPhrase"
	| "contextArea"
	| "houseWide"
	| "mediaOnly"
	| "noSentences"

export type HaDescriptorIntentReportType = {
	blocksKept: number
	blocksSkipped: Record<HaDescriptorBlockSkipReasonType, number>
	templatesKept: number
	templatesRewritten: number
	templatesDropped: Record<HaDescriptorTemplateDropReasonType, number>
	droppedSamples: string[]
}

export type HaDescriptorLanguageReportType = {
	language: string
	intents: number
	templates: number
	baseTemplates: number
	baseDuplicates: string[]
	rules: number
	ruleCollisions: string[]
	byIntent: Record<string, HaDescriptorIntentReportType>
}

export type HaDescriptorDraftType = {
	tool: string
	slots: Record<string, FastPathSlotType>
	argDefaults: Record<string, unknown> | null
	priority: number
	templates: { source: string; astKey: string }[]
}

export type FastPathDataPackType = {
	kind: string
	file: string
	block: FastPathBlockType
}

export type FastPathSyntheticEntityType = {
	name: string
	domain: string
	area: string
	floor: string
}

export type WebsiteDataMetaType = {
	source: string
	capturedAt: string
	generator: string
}

export type WebsiteFastPathTemplateType = {
	source: string
	ast: FastPathAstNodeType[]
	prefilter: string
}

export type WebsiteFastPathSlotValueType = {
	phrase: string
	args: Record<string, unknown>
}

export type WebsiteFastPathSlotType = {
	kind: "context" | "values" | "range" | "duration" | "clockTime"
	arg: string
	key?: string
	values?: WebsiteFastPathSlotValueType[]
	min?: number
	max?: number
	maxSeconds?: number
}

export type WebsiteFastPathIntentType = {
	tool: string
	provider: string
	templates: WebsiteFastPathTemplateType[]
	slots: Record<string, WebsiteFastPathSlotType>
	requiredKeywords: string[][]
	argDefaults: Record<string, unknown>
	priority: number
	allowBlockedTokens?: boolean
}

export type WebsiteFastPathPackType = {
	skipWords: string[]
	skipPhrasesPerSide: number
	maxUtteranceChars: number
	blockers: string[]
	minCoverage: number
	intents: WebsiteFastPathIntentType[]
}

export type WebsiteFastPathLanguageStatsType = {
	intents: number
	templates: number
	corpusActionRows: number
	corpusMatched: number
	corpusWrong: number
}

export type WebsiteFastPathPresetType = {
	id: string
	language: string
	text: string
}

export type WebsiteFastPathDemoAreaType = {
	id: string
	names: Record<string, string>
}

export type WebsiteFastPathDemoEntityType = {
	id: string
	domain: string
	area: string
	names: Record<string, string>
}

export type WebsiteFastPathFileType = {
	meta: WebsiteDataMetaType
	stats: {
		languages: Record<string, WebsiteFastPathLanguageStatsType>
		falsePositives: number
		matchMsP50: number
		matchMsP95: number
	}
	excludedDomains: string[]
	nameGroups: Record<string, string[]>
	languages: Record<string, WebsiteFastPathPackType>
	presets: WebsiteFastPathPresetType[]
	demoHome: {
		areas: WebsiteFastPathDemoAreaType[]
		entities: WebsiteFastPathDemoEntityType[]
	}
}

export type WebsiteSkillToolType = {
	id: string
	fastPath: boolean
	hidden: boolean
	policy: ToolPolicyType
}

export type WebsiteSkillGroupIdType =
	| "builtin"
	| "homeAssistant"
	| "musicAssistant"
	| "mcp"
	| "routines"

export type WebsiteSkillGroupType = {
	id: WebsiteSkillGroupIdType
	alwaysOn: boolean
	defaultOn: boolean
	tools: WebsiteSkillToolType[]
}

export type WebsiteSkillExampleIdType =
	| "timer"
	| "lights"
	| "music"
	| "goodNight"
	| "descriptor"

export type WebsiteSkillExampleType = {
	id: WebsiteSkillExampleIdType
	group: WebsiteSkillGroupIdType
	tool: string
	fastPath: boolean
}

export type WebsiteSkillsFileType = {
	meta: WebsiteDataMetaType
	groups: WebsiteSkillGroupType[]
	examples: WebsiteSkillExampleType[]
	routineMaxSteps: number
	descriptorResource: string
	strippedPolicyFields: string[]
	descriptorLimits: {
		maxBytes: number
		maxTemplates: number
		maxTemplateChars: number
	}
	defaults: {
		fastPathEnabled: boolean
		skillsEngine: boolean
		builtinTools: boolean
	}
}

export type WebsiteCorpusBaselineType = Record<
	string,
	{ matchedCorrect: number; wrong: number; falsePositives: number }
>

export type WebsiteCorpusSweepType = {
	languages: {
		language: string
		sentences: { action: number }
		fastPathMs: { p50: number; p95: number }
	}[]
}

export type WebsiteSourcedPackType = {
	provider: string
	block: FastPathBlockType
}

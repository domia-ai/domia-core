import { randomUUID } from "crypto"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"
import { eq } from "drizzle-orm"

import {
	dbClient,
	domia as domiaTable,
	interactionTrace,
	interactionSessionTrace,
	turnEvent,
	INTERACTION_INPUT_TYPE_ENUM,
	INTERACTION_STATUS_ENUM,
	RESPONSE_TYPE_ENUM,
	TTS_ENGINE_ENUM,
	type SkillToolType,
} from "@/db"
import {
	subscribeToDomiaBus,
	unsubscribeFromDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
} from "@/buses"
import { registerHostedIdentity } from "@/modules/core"
import type { DomiaType } from "@/modules/core"
import {
	collectReplyAudio,
	firstAudioCols,
	markFirstAudio,
	markLadderStage,
	registerStreamingSink,
	clearStreamingSink,
	spokenTextOf,
} from "@/modules/core-bus/utils"
import { deliverReply } from "@/modules/core-bus/controller/llm-done"
import { tryDelegatedReplyAudio } from "@/modules/core-bus/controller/stt-done/delegation"
import type {
	CoreBusContextType,
	CoreBusFeaturesType,
	SttFlowSessionType,
	StreamingSinkType,
} from "@/modules/core-bus"
import {
	getOrCreateInteractionId,
	getInteractionById,
	markPipelineStart,
} from "@/modules/session-manager"
import {
	readReplyAudio,
	setLocalService,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import {
	runAgentTurn,
	stripToolCallJson,
	AGENT_FAILURE_REPLY,
	type AgentInferenceType,
} from "@/modules/agent"
import type { TtsEngineAdapterType } from "@/modules/tts-engine"
import type { ToolCallOrReplyType, ToolChoiceType } from "@/modules/llm-engine"
import type {
	DomiaNodeServiceImplementation,
	ReplyAudioMessage,
} from "@/generated/proto/domia"
import { LLM_ERRORS, runWithTraceContext } from "@/utils"
import { getDomia } from "@/test-utils"

import { makeChecker, sleep } from "./lib"
import type { ReplyDeliveryEventsType, ReplyDeliveryFixtureType } from "./types"

const checker = makeChecker()

const HUB_KEY = "REPLY_EVAL_HUB"
const FIRST_CHUNK_DELAY_MS = 40
const SECOND_CHUNK_DELAY_MS = 120
const SPEECH_END_AGO_MS = 900
const EVENT_WAIT_MS = 5000
const CORE_BUS_DIR = join(process.cwd(), "src", "modules", "core-bus")
const FIRST_AUDIO_FILE = join("utils", "first-audio.ts")
const LOCAL_TTFA_RE =
	/\b(?:perceivedT|t)tfaMs\s*(?:=(?!=)|\?\?=|:\s*(?:pipelineElapsed|Date\.now))/

const REPLY_PATHS: { label: string; transcript: string; reply: string }[] = [
	{
		label: "LLM reply",
		transcript: "Who directed that one?",
		reply: "Steven Spielberg.",
	},
	{
		label: "fast-path reply",
		transcript: "Turn on the garage light.",
		reply: "Done, I turned on Garage Light.",
	},
	{
		label: "tool finalize",
		transcript: "Play Miles Davis in the living room.",
		reply: "Playing Miles Davis on Living Room.",
	},
	{
		label: "confirmation prompt",
		transcript: "Open the garage door.",
		reply:
			"You want me to open Garage Door. Do you want me to go ahead with that?",
	},
	{
		label: "respond-first acknowledgement",
		transcript: "Start the vacuum.",
		reply: "On it.",
	},
]

const fakeTts = (): TtsEngineAdapterType => ({
	id: TTS_ENGINE_ENUM.KOKORO,
	capabilities: {
		streaming: true,
		sampleRate: 24000,
		sampleFormat: "PCM_S16LE",
		channels: 1,
		languages: ["en"],
	},
	run: () => Promise.reject(new Error("run() unused in this eval")),
	runStream: async function* () {
		await sleep(FIRST_CHUNK_DELAY_MS)
		yield Buffer.alloc(2400, 1)
		await sleep(SECOND_CHUNK_DELAY_MS)
		yield Buffer.alloc(2400, 2)
	},
})

const featuresFor = (
	domia: DomiaType,
	canPlayback: boolean,
): CoreBusFeaturesType => ({
	capabilities: {
		wakeword: false,
		record: false,
		stt: false,
		intentDetection: false,
		intentExecution: false,
		promptGeneration: false,
		llm: false,
		tts: true,
		playback: canPlayback,
	},
	stt: null,
	llm: null,
	tts: domia.ttsConfig ? { adapter: fakeTts(), canStream: true } : null,
	canRunStt: false,
	canRunLlm: false,
	canRunTts: true,
	canPlayback,
	canStreamStt: false,
	canStreamLlm: false,
	canStreamTts: true,
	canSentencePipeline: false,
})

const createFixture = (): ReplyDeliveryFixtureType => {
	const id = randomUUID()
	const domiaKey = `REPLY_EVAL_${id.slice(0, 8)}`
	dbClient.insert(domiaTable).values({ id, name: "reply-eval", domiaKey }).run()
	const domia = getDomia({
		domiaOverrides: { id, domiaKey, name: "reply-eval" },
		moduleSettingsOverrides: {
			emotionEngine: false,
			emotionCapture: false,
			factCapture: false,
		},
		ttsConfigOverrides: { phraseCacheEnabled: false },
		runtimeCapabilitiesOverrides: { playback: false },
	})
	return { domia, domiaKey }
}

const destroyFixture = (fixture: ReplyDeliveryFixtureType): void => {
	const id = fixture.domia.id
	dbClient.delete(turnEvent).where(eq(turnEvent.domiaId, id)).run()
	dbClient
		.delete(interactionTrace)
		.where(eq(interactionTrace.domiaId, id))
		.run()
	dbClient
		.delete(interactionSessionTrace)
		.where(eq(interactionSessionTrace.domiaId, id))
		.run()
	dbClient.delete(domiaTable).where(eq(domiaTable.id, id)).run()
}

const newVoiceTurn = async (domia: DomiaType): Promise<string> => {
	const interactionId = await getOrCreateInteractionId(domia, undefined, {
		inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
		responseType: RESPONSE_TYPE_ENUM.VOICE,
	})
	if (!interactionId) throw new Error("interaction row could not be created")
	markPipelineStart(interactionId)
	return interactionId
}

const watchTurn = (domiaId: string): ReplyDeliveryEventsType => {
	const events: ReplyDeliveryEventsType = {
		ttsDone: [],
		failed: [],
		playbackFinished: [],
		stop: () => undefined,
	}
	const onTts = (p: unknown): void => void events.ttsDone.push(p)
	const onFailed = (p: unknown): void => void events.failed.push(p)
	const onFinished = (p: unknown): void => void events.playbackFinished.push(p)
	subscribeToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, onTts)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
		onFailed,
	)
	subscribeToDomiaBus(
		domiaId,
		DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED,
		onFinished,
	)
	events.stop = () => {
		unsubscribeFromDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.TTS_DONE, onTts)
		unsubscribeFromDomiaBus(
			domiaId,
			DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
			onFailed,
		)
		unsubscribeFromDomiaBus(
			domiaId,
			DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED,
			onFinished,
		)
	}
	return events
}

const waitFor = async (done: () => boolean): Promise<boolean> => {
	const deadline = Date.now() + EVENT_WAIT_MS
	while (Date.now() < deadline) {
		if (done()) return true
		await sleep(10)
	}
	return done()
}

const sourceFilesUnder = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) return sourceFilesUnder(full)
		return full.endsWith(".ts") ? [full] : []
	})

const checkOneHelper = (): void => {
	console.log("\nfirst audio: one helper owns the measurement")
	const offenders = sourceFilesUnder(CORE_BUS_DIR)
		.filter((file) => relative(CORE_BUS_DIR, file) !== FIRST_AUDIO_FILE)
		.filter((file) => LOCAL_TTFA_RE.test(readFileSync(file, "utf8")))
		.map((file) => relative(CORE_BUS_DIR, file))
	checker.check(
		"no core-bus reply path computes ttfaMs or perceivedTtfaMs on its own",
		offenders.length === 0,
		`offenders=${JSON.stringify(offenders)}`,
	)
}

const checkHelperSemantics = async (): Promise<void> => {
	console.log("\nfirst audio: synthesized vs played")
	const synthesized = randomUUID()
	markPipelineStart(synthesized)
	await sleep(25)
	markFirstAudio(synthesized)
	const first = firstAudioCols(synthesized)
	checker.check(
		"a synthesized chunk records ttfaMs from the pipeline start",
		first.ttfaMs !== undefined && first.ttfaMs >= 20,
		JSON.stringify(first),
	)
	checker.check(
		"a synthesized chunk never records perceivedTtfaMs",
		first.perceivedTtfaMs === undefined,
		JSON.stringify(first),
	)
	markLadderStage(synthesized, "speechEndAt", Date.now() - SPEECH_END_AGO_MS)
	await sleep(25)
	markFirstAudio(synthesized, { played: true })
	const played = firstAudioCols(synthesized)
	checker.check(
		"real playback adds perceivedTtfaMs from the end of speech",
		played.perceivedTtfaMs !== undefined &&
			played.perceivedTtfaMs >= SPEECH_END_AGO_MS,
		JSON.stringify(played),
	)
	checker.check(
		"the first mark wins: playback does not move ttfaMs",
		played.ttfaMs === first.ttfaMs,
		`first=${JSON.stringify(first)} played=${JSON.stringify(played)}`,
	)
	const unclocked = randomUUID()
	markFirstAudio(unclocked, { played: true, since: Date.now() - 300 })
	const fallback = firstAudioCols(unclocked)
	checker.check(
		"without a pipeline clock the caller's start is the reference",
		fallback.ttfaMs !== undefined && fallback.ttfaMs >= 300,
		JSON.stringify(fallback),
	)
	checker.check(
		"no end of speech means no perceivedTtfaMs even when played",
		fallback.perceivedTtfaMs === undefined,
		JSON.stringify(fallback),
	)

	const collected = randomUUID()
	markPipelineStart(collected)
	const startedAt = Date.now()
	const file = await collectReplyAudio(
		collected,
		fakeTts().runStream?.(getDomia({}), "hello") ?? emptyAudio(),
		{ sampleRate: 24000, channels: 1 },
	)
	const elapsed = Date.now() - startedAt
	const cols = firstAudioCols(collected)
	checker.check(
		"collected audio is timed at its first chunk, not at the end",
		cols.ttfaMs !== undefined &&
			cols.ttfaMs >= FIRST_CHUNK_DELAY_MS - 5 &&
			cols.ttfaMs < elapsed - SECOND_CHUNK_DELAY_MS / 2,
		`ttfaMs=${cols.ttfaMs} elapsed=${elapsed}`,
	)
	checker.check(
		"collected audio lands in one file with every chunk",
		file.chunkCount === 2 && file.filePath.endsWith(".wav"),
		JSON.stringify(file),
	)
	const empty = await collectReplyAudio(randomUUID(), emptyAudio(), {
		sampleRate: 24000,
		channels: 1,
	}).then(
		() => null,
		(err: unknown) => err,
	)
	checker.check(
		"an empty synthesis throws instead of writing a silent file",
		empty instanceof Error,
		String(empty),
	)
}

const emptyAudio = (): AsyncIterable<Buffer> => ({
	[Symbol.asyncIterator]: () => ({
		next: () => Promise.resolve({ done: true, value: undefined }),
	}),
})

const checkNoPlaybackPaths = async (
	fixture: ReplyDeliveryFixtureType,
): Promise<void> => {
	console.log("\nfirst audio: an identity that does not play locally")
	const { domia } = fixture
	const ctx: CoreBusContextType = {
		domia,
		features: featuresFor(domia, false),
	}
	for (const path of REPLY_PATHS) {
		const interactionId = await newVoiceTurn(domia)
		markLadderStage(
			interactionId,
			"speechEndAt",
			Date.now() - SPEECH_END_AGO_MS,
		)
		const events = watchTurn(domia.id)
		const startedAt = Date.now()
		await deliverReply(ctx, {
			reply: path.reply,
			transcript: path.transcript,
			interactionId,
			originDomiaKey: domia.domiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
		})
		await waitFor(() => events.ttsDone.length > 0)
		events.stop()
		const elapsed = Date.now() - startedAt
		const trace = await getInteractionById(interactionId)
		checker.check(
			`${path.label}: ttfa_ms is recorded without local playback`,
			typeof trace?.ttfaMs === "number" && trace.ttfaMs > 0,
			`ttfaMs=${trace?.ttfaMs}`,
		)
		checker.check(
			`${path.label}: ttfa_ms is the first synthesized chunk, before the audio is complete`,
			typeof trace?.ttfaMs === "number" &&
				trace.ttfaMs < elapsed - SECOND_CHUNK_DELAY_MS / 2,
			`ttfaMs=${trace?.ttfaMs} elapsed=${elapsed}`,
		)
		checker.check(
			`${path.label}: perceived_ttfa_ms stays empty when nobody played it`,
			trace?.perceivedTtfaMs == null,
			`perceivedTtfaMs=${trace?.perceivedTtfaMs}`,
		)
		checker.check(
			`${path.label}: the audio is delivered as a file by the TTS executor`,
			events.ttsDone.length === 1 &&
				typeof trace?.ttsAudioPath === "string" &&
				trace.ttsExecutorKey === domia.domiaKey &&
				(trace.ttsMs ?? 0) > 0,
			`events=${events.ttsDone.length} path=${trace?.ttsAudioPath} executor=${trace?.ttsExecutorKey}`,
		)
	}
}

const recordingSink = (written: Buffer[]): StreamingSinkType => ({
	write: (chunk) => {
		written.push(chunk)
	},
})

const checkPlayedPath = async (
	fixture: ReplyDeliveryFixtureType,
): Promise<void> => {
	console.log("\nfirst audio: a sink that really plays")
	const { domia } = fixture
	const ctx: CoreBusContextType = {
		domia,
		features: featuresFor(domia, false),
	}
	const interactionId = await newVoiceTurn(domia)
	markLadderStage(interactionId, "speechEndAt", Date.now() - SPEECH_END_AGO_MS)
	const written: Buffer[] = []
	registerStreamingSink(interactionId, recordingSink(written))
	const events = watchTurn(domia.id)
	try {
		await deliverReply(ctx, {
			reply: "Steven Spielberg.",
			transcript: "Who directed that one?",
			interactionId,
			originDomiaKey: domia.domiaKey,
			responseType: RESPONSE_TYPE_ENUM.VOICE,
		})
		await waitFor(() => events.playbackFinished.length > 0)
	} finally {
		events.stop()
		clearStreamingSink(interactionId)
	}
	const trace = await getInteractionById(interactionId)
	checker.check(
		"played audio records both ttfa_ms and perceived_ttfa_ms",
		typeof trace?.ttfaMs === "number" &&
			typeof trace.perceivedTtfaMs === "number" &&
			trace.perceivedTtfaMs >= SPEECH_END_AGO_MS,
		`ttfaMs=${trace?.ttfaMs} perceived=${trace?.perceivedTtfaMs} chunks=${written.length}`,
	)
}

const audioMessage = (byte: number): ReplyAudioMessage => ({
	payload: {
		$case: "audio",
		audio: { pcm: Buffer.alloc(2400, byte), sampleRate: 24000, channels: 1 },
	},
})

const replyStream = (
	finalReply: string | null,
	state: { yielded: number; failAfter?: number },
): AsyncIterable<ReplyAudioMessage> =>
	(async function* (): AsyncIterable<ReplyAudioMessage> {
		for (let i = 1; i <= 3; i++) {
			await sleep(15)
			if (state.failAfter !== undefined && i > state.failAfter)
				throw new Error("stream broke")
			state.yielded = i
			yield audioMessage(i)
		}
		await sleep(15)
		if (finalReply !== null)
			yield { payload: { $case: "finalReply", finalReply } }
	})()

const STORY =
	"Once upon a time a little dragon was afraid of the dark. His friend the firefly lit the cave for him. He slept soundly ever after."

const checkReplyReader = async (): Promise<void> => {
	console.log("\ndelegated reply: the text survives an early audio close")
	const early = { yielded: 0 }
	const reader = readReplyAudio(replyStream(STORY, early))
	let consumed = 0
	for await (const chunk of reader.audio) {
		consumed += chunk.length > 0 ? 1 : 0
		if (consumed === 2) break
	}
	const lateReply = await reader.finalReplyPromise
	checker.check(
		"a player that stops after two of three chunks still gets the final reply",
		consumed === 2 && lateReply === STORY,
		`consumed=${consumed} reply=${JSON.stringify(lateReply)}`,
	)
	checker.check(
		"the rest of the stream is drained, not cancelled",
		early.yielded === 3,
		`yielded=${early.yielded}`,
	)

	const full = readReplyAudio(replyStream(STORY, { yielded: 0 }))
	let all = 0
	for await (const chunk of full.audio) all += chunk.length > 0 ? 1 : 0
	checker.check(
		"a player that drains everything gets the same reply",
		all === 3 && (await full.finalReplyPromise) === STORY,
		`chunks=${all}`,
	)

	const silent = readReplyAudio(replyStream(null, { yielded: 0 }))
	for await (const chunk of silent.audio) void chunk
	checker.check(
		"a stream that ends without a final reply resolves empty instead of hanging",
		(await silent.finalReplyPromise) === "" &&
			(await silent.transcriptPromise) === "",
	)

	const broken = readReplyAudio(
		replyStream(STORY, { yielded: 0, failAfter: 1 }),
	)
	let brokenChunks = 0
	for await (const chunk of broken.audio) {
		brokenChunks += chunk.length > 0 ? 1 : 0
		break
	}
	checker.check(
		"a stream that breaks while draining resolves empty instead of hanging",
		brokenChunks === 1 && (await broken.finalReplyPromise) === "",
	)
}

const hubTarget: DeliverEventTarget = {
	domiaKey: HUB_KEY,
	domiaId: "reply-eval-hub",
	localIp: "127.0.0.1",
	grpcPort: 1,
	grpcTls: false,
	source: "explicit",
	streamingCapabilities: { stt: true, llm: true, tts: true },
}

const sessionFor = (
	domia: DomiaType,
	interactionId: string,
	transcript: string,
): SttFlowSessionType => ({
	interactionId,
	promptContext: transcript,
	transcript,
	originDomiaKey: domia.domiaKey,
	responseType: RESPONSE_TYPE_ENUM.VOICE,
	isVoice: true,
	recentTurns: [],
	knownFacts: [],
	userMoodTrend: [],
	knowledgeBase: [],
	previously: [],
	userModel: null,
})

const checkDelegatedReply = async (
	fixture: ReplyDeliveryFixtureType,
): Promise<void> => {
	console.log("\ndelegated reply: an empty final text never ends as ok")
	const { domia } = fixture
	const ctx: CoreBusContextType = {
		domia,
		features: featuresFor(domia, true),
	}
	registerHostedIdentity(HUB_KEY)
	const hub = { finalReply: STORY }
	setLocalService({
		streamReplyAudio: () => replyStream(hub.finalReply, { yielded: 0 }),
	} as unknown as DomiaNodeServiceImplementation)

	const spoken = await newVoiceTurn(domia)
	registerStreamingSink(spoken, recordingSink([]))
	const spokenEvents = watchTurn(domia.id)
	const handled = await runWithTraceContext(
		{ interactionId: spoken, originDomiaKey: domia.domiaKey },
		() =>
			tryDelegatedReplyAudio(
				ctx,
				sessionFor(domia, spoken, "Tell me a short bedtime story."),
				[hubTarget],
			),
	)
	await waitFor(() => spokenEvents.playbackFinished.length > 0)
	spokenEvents.stop()
	clearStreamingSink(spoken)
	const spokenTrace = await getInteractionById(spoken)
	checker.check(
		"a delegated reply keeps its text, executor and first audio in the trace",
		handled &&
			spokenTrace?.llmResponse === STORY &&
			spokenTrace.llmExecutorKey === HUB_KEY &&
			typeof spokenTrace.ttfaMs === "number" &&
			spokenTrace.status === INTERACTION_STATUS_ENUM.OK &&
			spokenEvents.failed.length === 0,
		`llmResponse=${JSON.stringify(spokenTrace?.llmResponse)} status=${spokenTrace?.status} failed=${spokenEvents.failed.length}`,
	)

	hub.finalReply = "  "
	const empty = await newVoiceTurn(domia)
	registerStreamingSink(empty, recordingSink([]))
	const emptyEvents = watchTurn(domia.id)
	const emptyHandled = await runWithTraceContext(
		{ interactionId: empty, originDomiaKey: domia.domiaKey },
		() =>
			tryDelegatedReplyAudio(
				ctx,
				sessionFor(domia, empty, "What's on tonight's menu?"),
				[hubTarget],
			),
	)
	await waitFor(() => emptyEvents.failed.length > 0)
	emptyEvents.stop()
	clearStreamingSink(empty)
	const failure = emptyEvents.failed[0] as
		| { step?: string; errorCode?: string; interactionId?: string }
		| undefined
	const emptyTrace = await getInteractionById(empty)
	checker.check(
		"an empty delegated reply fails loudly on the llm step",
		emptyHandled &&
			failure?.step === "llm" &&
			failure.errorCode === LLM_ERRORS.EMPTY_REPLY.code &&
			failure.interactionId === empty,
		JSON.stringify(failure),
	)
	checker.check(
		"an empty delegated reply is never completed as a spoken turn",
		emptyEvents.playbackFinished.length === 0 &&
			!emptyTrace?.llmResponse &&
			!emptyTrace?.heardReply,
		`finished=${emptyEvents.playbackFinished.length} llmResponse=${JSON.stringify(emptyTrace?.llmResponse)}`,
	)
}

const STORY_TOOLS: SkillToolType[] = [
	{
		provider: "music",
		rawName: "music_now_playing",
		namespacedName: "music__music_now_playing",
		description: "Reads what is playing.",
		inputSchema: { type: "object", properties: {} },
	},
]

const recordedInference = (
	steps: ToolCallOrReplyType[],
	choices: (ToolChoiceType | undefined)[],
): AgentInferenceType => {
	let i = 0
	return (_messages, _tools, toolChoice) => {
		choices.push(toolChoice)
		return Promise.resolve(steps[Math.min(i++, steps.length - 1)])
	}
}

const checkAgentReplies = async (
	fixture: ReplyDeliveryFixtureType,
): Promise<void> => {
	console.log("\nagent reply: tool-call JSON never reaches the speaker")
	const { domia } = fixture
	const leaked = `I'd be happy to tell you a bedtime story. Here's a story about a dragon who is afraid of the dark. {"name":"music_now_playing","parameters":{}}`
	checker.check(
		"an embedded tool call is cut out of the text",
		stripToolCallJson(leaked) ===
			"I'd be happy to tell you a bedtime story. Here's a story about a dragon who is afraid of the dark.",
		stripToolCallJson(leaked),
	)
	checker.check(
		"braces that are not a tool call are left alone",
		stripToolCallJson("The set {1, 2} has two members.") ===
			"The set {1, 2} has two members.",
	)
	checker.check(
		"a reply that is only a tool call has nothing left to speak",
		spokenTextOf(
			stripToolCallJson('{"name":"music_now_playing","parameters":{}}'),
		) === "",
	)

	const choices: (ToolChoiceType | undefined)[] = []
	const regenerated = await runAgentTurn(
		domia,
		"Tell me a short bedtime story about a dragon who is afraid of the dark.",
		STORY_TOOLS,
		recordedInference(
			[
				{ kind: "reply", text: leaked },
				{ kind: "reply", text: STORY },
			],
			choices,
		),
		{ voice: true },
	)
	checker.check(
		"a reply that leaked a tool call is regenerated as a plain answer",
		regenerated.reply === STORY &&
			choices.length === 2 &&
			choices[1] === "none" &&
			regenerated.toolNamesUsed.length === 0,
		`reply=${JSON.stringify(regenerated.reply)} choices=${JSON.stringify(choices)}`,
	)

	const emptyChoices: (ToolChoiceType | undefined)[] = []
	const emptyFirst = await runAgentTurn(
		domia,
		"What's on tonight's menu?",
		STORY_TOOLS,
		recordedInference(
			[
				{ kind: "reply", text: "" },
				{ kind: "reply", text: "Salmon, then a pear tart." },
			],
			emptyChoices,
		),
		{ voice: true },
	)
	checker.check(
		"an empty reply is regenerated once without tools",
		emptyFirst.reply === "Salmon, then a pear tart." &&
			emptyChoices[1] === "none",
		`reply=${JSON.stringify(emptyFirst.reply)} choices=${JSON.stringify(emptyChoices)}`,
	)

	const stubborn = await runAgentTurn(
		domia,
		"What's on tonight's menu?",
		STORY_TOOLS,
		recordedInference(
			[{ kind: "reply", text: '{"name":"music_now_playing","parameters":{}}' }],
			[],
		),
		{ voice: true },
	)
	checker.check(
		"a model that keeps answering with a tool call ends in the spoken failure, never in silence",
		stubborn.reply === AGENT_FAILURE_REPLY && stubborn.reply.trim().length > 0,
		JSON.stringify(stubborn.reply),
	)
}

const main = async (): Promise<void> => {
	const fixture = createFixture()
	try {
		checkOneHelper()
		await checkHelperSemantics()
		await checkNoPlaybackPaths(fixture)
		await checkPlayedPath(fixture)
		await checkReplyReader()
		await checkDelegatedReply(fixture)
		await checkAgentReplies(fixture)
	} finally {
		await sleep(200)
		destroyFixture(fixture)
	}
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} reply-delivery checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()

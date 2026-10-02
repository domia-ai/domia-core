import { randomUUID } from "crypto"
import { eq } from "drizzle-orm"

import {
	dbClient,
	domia as domiaTable,
	factEvidence,
	interactionSessionTrace,
	interactionTrace,
	memoryFact,
	INTENT_DECISION_ENUM,
	LLM_ENGINE_ENUM,
	type ToolTraceEntryType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { llmEngineRegistry } from "@/modules/llm-engine"
import { upsertFacts } from "@/modules/memory"
import {
	captureFlagsFor,
	reflectOnInteraction,
	turnKindOf,
	TURN_KIND_ENUM,
	TURN_KIND_ENUM_VALUES,
	REFLECTION_CAPTURE_BY_TURN_KIND,
} from "@/modules/reflection"
import { getDomia } from "@/test-utils"

import { makeChecker } from "./lib"
import type { ReflectionTurnCaseType } from "./types"

const checker = makeChecker()

const CAPTURED_TURNS: ReflectionTurnCaseType[] = [
	{
		label: "fast-path light command",
		userText: "Turn off the kitchen light.",
		reply: "Done, I turned off Kitchen Light.",
		trace: {
			intentDecision: "fast-path:home-assistant__HassTurnOff",
			toolCallCount: 1,
			skillResponse: [{ kind: "result" }],
		},
		junk: {
			subject: "the user",
			relation: "has kitchen light",
			value: "Kitchen Light",
		},
		kind: TURN_KIND_ENUM.FAST_PATH,
	},
	{
		label: "fast-path timer",
		userText: "Set a timer for one hour.",
		reply: "Timer set for 1 hour.",
		trace: {
			intentDecision: "fast-path:domia__timer",
			toolCallCount: 1,
			skillResponse: [{ kind: "result" }],
		},
		junk: {
			subject: "the user",
			relation: "has a timer set",
			value: "one hour",
		},
		kind: TURN_KIND_ENUM.FAST_PATH,
	},
	{
		label: "tool turn through the agent",
		userText: "Play Miles Davis in the living room.",
		reply: "Playing Miles Davis on Living Room.",
		trace: {
			intentDecision: "skill (embedding:0.70)",
			toolCallCount: 1,
			skillResponse: [{ kind: "result" }, { kind: "summary" }],
		},
		junk: { subject: "the user", relation: "likes", value: "Miles Davis" },
		kind: TURN_KIND_ENUM.TOOL,
	},
	{
		label: "failed remember tool",
		userText: "Remember that the pantry always has rice and lentils.",
		reply: "I couldn't keep that as a fact about you.",
		trace: {
			intentDecision: "skill (builtin-keyword)",
			toolCallCount: 1,
			skillResponse: [
				{ kind: "result", tool: "domia__remember", status: "failed" },
				{ kind: "summary" },
			],
		},
		junk: {
			subject: "the user",
			relation: "has favorite food",
			value: "rice and lentils",
		},
		kind: TURN_KIND_ENUM.TOOL,
	},
	{
		label: "remember next to another tool",
		userText: "Remember that I love pasta and set a timer for ten minutes.",
		reply: "Got it, I'll remember that. Timer set for 10 minutes.",
		trace: {
			intentDecision: "skill (builtin-keyword)",
			toolCallCount: 2,
			skillResponse: [
				{ kind: "result", tool: "domia__remember", status: "ok" },
				{ kind: "result", tool: "domia__timer", status: "ok" },
				{ kind: "summary" },
			],
		},
		junk: { subject: "the user", relation: "likes", value: "pasta" },
		kind: TURN_KIND_ENUM.TOOL,
	},
	{
		label: "remember next to a dispatched tool",
		userText: "Remember that I love jazz and play some in the kitchen.",
		reply: "Got it, I'll remember that.",
		trace: {
			intentDecision: "skill (embedding:0.66)",
			toolCallCount: 2,
			skillResponse: [
				{ kind: "result", tool: "domia__remember", status: "ok" },
				{ kind: "dispatched", tool: "music-assistant__play_media" },
				{ kind: "summary" },
			],
		},
		junk: { subject: "the user", relation: "likes", value: "jazz" },
		kind: TURN_KIND_ENUM.TOOL,
	},
	{
		label: "confirmation prompt parked by the agent",
		userText: "Lock the front door.",
		reply:
			"You want me to lock Front Door. Do you want me to go ahead with that?",
		trace: {
			intentDecision: "skill (embedding:0.74)",
			toolCallCount: null,
			skillResponse: [{ kind: "summary" }],
		},
		junk: { subject: "the user", relation: "likes", value: "Front Door" },
		kind: TURN_KIND_ENUM.TOOL,
	},
	{
		label: "confirmation settled with yes",
		userText: "Yes.",
		reply: "Done, I locked Front Door.",
		trace: {
			intentDecision: `${INTENT_DECISION_ENUM.CONFIRMATION}:approved`,
			toolCallCount: 1,
			skillResponse: [{ kind: "result" }],
		},
		junk: { subject: "the user", relation: "is named", value: "Yes" },
		kind: TURN_KIND_ENUM.CONFIRMATION,
	},
	{
		label: "confirmation settled with no",
		userText: "No.",
		reply: "Okay, I won't do that.",
		trace: {
			intentDecision: `${INTENT_DECISION_ENUM.CONFIRMATION}:denied`,
			toolCallCount: null,
			skillResponse: [{ kind: "result" }],
		},
		junk: { subject: "the user", relation: "is named", value: "No" },
		kind: TURN_KIND_ENUM.CONFIRMATION,
	},
	{
		label: "elicitation answer",
		userText: "The kitchen one.",
		reply: "Done.",
		trace: {
			intentDecision: INTENT_DECISION_ENUM.ELICIT_ANSWER,
			toolCallCount: null,
			skillResponse: null,
		},
		junk: { subject: "the user", relation: "has", value: "kitchen" },
		kind: TURN_KIND_ENUM.CONFIRMATION,
	},
	{
		label: "bare-entity clarification",
		userText: "Kitchen light.",
		reply: "What should I do with kitchen light?",
		trace: {
			intentDecision: "clarify:Kitchen Light",
			toolCallCount: null,
			skillResponse: null,
		},
		junk: { subject: "the user", relation: "has", value: "Kitchen light" },
		kind: TURN_KIND_ENUM.CLARIFICATION,
	},
	{
		label: "bare yes with nothing to settle",
		userText: "Yes.",
		reply: "Wonderful, let us begin.",
		trace: { intentDecision: null, toolCallCount: null, skillResponse: null },
		junk: { subject: "the user", relation: "is named", value: "Yes" },
		kind: TURN_KIND_ENUM.ACKNOWLEDGEMENT,
	},
	{
		label: "bare spanish yes",
		userText: "Sí.",
		reply: "De acuerdo.",
		language: "es",
		trace: { intentDecision: null, toolCallCount: null, skillResponse: null },
		junk: { subject: "the user", relation: "is named", value: "Sí" },
		kind: TURN_KIND_ENUM.ACKNOWLEDGEMENT,
	},
]

const CONVERSATION_TURNS: ReflectionTurnCaseType[] = [
	{
		label: "first-person preference routed to chat",
		userText: "I love green tea in the evening.",
		reply: "A calm choice for the evening.",
		trace: {
			intentDecision: "chat (embedding:0.41)",
			toolCallCount: null,
			skillResponse: null,
		},
		junk: { subject: "the user", relation: "likes", value: "green tea" },
		kind: TURN_KIND_ENUM.CONVERSATION,
	},
	{
		label: "chat on an identity without routable tools",
		userText: "I am allergic to cilantro, keep that in mind for dinner.",
		reply: "Noted, no cilantro tonight.",
		trace: {
			intentDecision: "chat (no-routable-tools)",
			toolCallCount: null,
			skillResponse: null,
		},
		junk: {
			subject: "the user",
			relation: "is allergic to",
			value: "cilantro",
		},
		kind: TURN_KIND_ENUM.CONVERSATION,
	},
	{
		label: "text turn with no routing decision",
		userText: "I live in Madrid near the old market.",
		reply: "A lovely part of the city.",
		trace: { intentDecision: null, toolCallCount: null, skillResponse: null },
		junk: { subject: "the user", relation: "lives in", value: "Madrid" },
		kind: TURN_KIND_ENUM.CONVERSATION,
	},
	{
		label: "a sentence that merely starts with yes",
		userText: "Yes, and my favorite color is blue.",
		reply: "Blue it is.",
		trace: { intentDecision: null, toolCallCount: null, skillResponse: null },
		junk: {
			subject: "the user",
			relation: "has favorite color",
			value: "blue",
		},
		kind: TURN_KIND_ENUM.CONVERSATION,
	},
]

const REMEMBER_OK_TRACE = [
	{ kind: "result", tool: "domia__remember", status: "ok" },
	{ kind: "summary" },
]

const MEMORY_WRITE_TURNS: ReflectionTurnCaseType[] = [
	{
		label: "remember-only turn routed as a skill",
		userText: "Remember that my name is Laura and I can't stand olives.",
		reply: "Got it, I'll remember that.",
		trace: {
			intentDecision: "skill (builtin-keyword)",
			toolCallCount: 1,
			skillResponse: REMEMBER_OK_TRACE,
		},
		junk: { subject: "the user", relation: "dislikes", value: "olives" },
		kind: TURN_KIND_ENUM.MEMORY_WRITE,
	},
	{
		label: "remember-only turn under a chat decision",
		userText: "Remember that my favorite color is blue.",
		reply: "Got it, I'll remember that.",
		trace: {
			intentDecision: "chat (embedding:0.30)",
			toolCallCount: 1,
			skillResponse: REMEMBER_OK_TRACE,
		},
		junk: {
			subject: "the user",
			relation: "has favorite color",
			value: "blue",
		},
		kind: TURN_KIND_ENUM.MEMORY_WRITE,
	},
]

const checkClassification = (): void => {
	console.log("\nturn kind from what the trace knows")
	for (const turn of [
		...CAPTURED_TURNS,
		...MEMORY_WRITE_TURNS,
		...CONVERSATION_TURNS,
	]) {
		const kind = turnKindOf(turn.trace, turn.userText, turn.language ?? "en")
		checker.check(
			`${turn.label} → ${turn.kind}`,
			kind === turn.kind,
			`got=${kind}`,
		)
	}
	checker.check(
		"a turn without a trace is judged by its words alone",
		turnKindOf(null, "Yes.", "en") === TURN_KIND_ENUM.ACKNOWLEDGEMENT &&
			turnKindOf(undefined, "I live in Madrid.", "en") ===
				TURN_KIND_ENUM.CONVERSATION,
	)
	checker.check(
		"a skill decision that ran no tool is still a conversation",
		turnKindOf(
			{
				intentDecision: "skill (builtin-keyword)",
				toolCallCount: 0,
				skillResponse: null,
			},
			"I had a great time with my sister Elena.",
			"en",
		) === TURN_KIND_ENUM.CONVERSATION,
	)
	checker.check(
		"a chat decision that still ran a tool counts as a tool turn",
		turnKindOf(
			{ intentDecision: "chat (embedding:0.30)", toolCallCount: 2 },
			"what about now",
			"en",
		) === TURN_KIND_ENUM.TOOL,
	)
}

const checkCaptureTable = (): void => {
	console.log("\ncapture flags per turn kind")
	const enabled = { emotion: true, facts: true }
	checker.check(
		"every turn kind has a capture row",
		TURN_KIND_ENUM_VALUES.every(
			(kind) => kind in REFLECTION_CAPTURE_BY_TURN_KIND,
		),
	)
	checker.check(
		"only conversation and memory-write turns feed fact extraction",
		TURN_KIND_ENUM_VALUES.filter((kind) => captureFlagsFor(enabled, kind).facts)
			.length === 2 &&
			captureFlagsFor(enabled, TURN_KIND_ENUM.CONVERSATION).facts &&
			captureFlagsFor(enabled, TURN_KIND_ENUM.MEMORY_WRITE).facts,
	)
	checker.check(
		"command kinds do not move the mood either",
		TURN_KIND_ENUM_VALUES.filter(
			(kind) => kind !== TURN_KIND_ENUM.CONVERSATION,
		).every((kind) => !captureFlagsFor(enabled, kind).emotion),
	)
	checker.check(
		"the identity's own switches still win over the table",
		!captureFlagsFor(
			{ emotion: true, facts: false },
			TURN_KIND_ENUM.CONVERSATION,
		).facts &&
			captureFlagsFor(
				{ emotion: true, facts: false },
				TURN_KIND_ENUM.CONVERSATION,
			).emotion,
	)
}

const llm = { calls: 0, next: "{}" }

const installFakeLlm = (): (() => void) => {
	const original = llmEngineRegistry[LLM_ENGINE_ENUM.OLLAMA]
	llmEngineRegistry[LLM_ENGINE_ENUM.OLLAMA] = {
		...original,
		runJson: () => {
			llm.calls++
			return Promise.resolve(llm.next)
		},
	}
	return () => {
		llmEngineRegistry[LLM_ENGINE_ENUM.OLLAMA] = original
	}
}

const createIdentity = (): DomiaType => {
	const id = randomUUID()
	const domiaKey = `REFLECTION_EVAL_${id.slice(0, 8)}`
	dbClient
		.insert(domiaTable)
		.values({ id, name: "reflection-eval", domiaKey })
		.run()
	return getDomia({
		domiaOverrides: { id, domiaKey, name: "reflection-eval" },
		moduleSettingsOverrides: {
			emotionEngine: false,
			emotionCapture: false,
			factCapture: true,
			reflectionOnlyWhenIdle: false,
			reflectionYieldToVoice: false,
		},
		characterProfileOverrides: { name: "Atlas", language: "en" },
		llmModelConfigOverrides: {
			engine: LLM_ENGINE_ENUM.OLLAMA,
			reflectionModelName: null,
		},
	})
}

const destroyIdentity = (domia: DomiaType): void => {
	const facts = dbClient
		.select({ id: memoryFact.id })
		.from(memoryFact)
		.where(eq(memoryFact.domiaId, domia.id))
		.all()
	for (const fact of facts)
		dbClient.delete(factEvidence).where(eq(factEvidence.factId, fact.id)).run()
	dbClient.delete(memoryFact).where(eq(memoryFact.domiaId, domia.id)).run()
	dbClient
		.delete(interactionTrace)
		.where(eq(interactionTrace.domiaId, domia.id))
		.run()
	dbClient
		.delete(interactionSessionTrace)
		.where(eq(interactionSessionTrace.domiaId, domia.id))
		.run()
	dbClient.delete(domiaTable).where(eq(domiaTable.id, domia.id)).run()
}

const storedFacts = (domia: DomiaType): string[] =>
	dbClient
		.select()
		.from(memoryFact)
		.where(eq(memoryFact.domiaId, domia.id))
		.all()
		.map((f) => `${f.subject} ${f.relation} ${f.value}`)

const reflectTurn = async (
	domia: DomiaType,
	sessionTraceId: string,
	sessionId: string,
	turn: ReflectionTurnCaseType,
): Promise<{ calls: number; facts: string[] }> => {
	const interactionId = randomUUID()
	dbClient
		.insert(interactionTrace)
		.values({
			id: interactionId,
			domiaId: domia.id,
			interactionSessionTraceId: sessionTraceId,
			sessionId,
			sttResult: turn.userText,
			llmResponse: turn.reply,
			intentDecision: turn.trace.intentDecision ?? null,
			toolCallCount: turn.trace.toolCallCount ?? null,
			skillResponse:
				(turn.trace.skillResponse as ToolTraceEntryType[] | null | undefined) ??
				null,
		})
		.run()
	const before = storedFacts(domia)
	llm.calls = 0
	llm.next = JSON.stringify({ facts: [{ ...turn.junk, confidence: 1 }] })
	await reflectOnInteraction(
		domia,
		turn.userText,
		turn.reply,
		interactionId,
		domia.domiaKey,
	)
	const after = storedFacts(domia)
	return {
		calls: llm.calls,
		facts: after.filter((f) => !before.includes(f)),
	}
}

const checkMemoryWriteTurn = async (
	domia: DomiaType,
	sessionTraceId: string,
	sessionId: string,
): Promise<void> => {
	const turn = MEMORY_WRITE_TURNS[0]
	const interactionId = randomUUID()
	dbClient
		.insert(interactionTrace)
		.values({
			id: interactionId,
			domiaId: domia.id,
			interactionSessionTraceId: sessionTraceId,
			sessionId,
			sttResult: turn.userText,
			llmResponse: turn.reply,
			intentDecision: turn.trace.intentDecision ?? null,
			toolCallCount: turn.trace.toolCallCount ?? null,
			skillResponse: turn.trace.skillResponse as ToolTraceEntryType[],
		})
		.run()
	await upsertFacts(
		domia,
		[
			{
				subject: "the user",
				relation: "is named",
				value: "Laura",
				explicit: true,
			},
		],
		interactionId,
	)
	llm.calls = 0
	llm.next = JSON.stringify({
		facts: [
			{
				subject: "the user",
				relation: "is named",
				value: "Laura",
				confidence: 1,
			},
			{ ...turn.junk, confidence: 1 },
		],
	})
	await reflectOnInteraction(
		domia,
		turn.userText,
		turn.reply,
		interactionId,
		domia.domiaKey,
	)
	const facts = storedFacts(domia)
	const named = facts.filter((f) => f.includes("Laura"))
	const disliked = facts.filter((f) => f.includes("olives"))
	checker.check(
		"a remember-only turn is reflected and keeps both facts once",
		llm.calls > 0 &&
			named.length === 1 &&
			disliked.length === 1 &&
			disliked[0].includes("dislikes"),
		`calls=${llm.calls} facts=${JSON.stringify(facts)}`,
	)
}

const checkReflection = async (): Promise<void> => {
	console.log("\nreflection on the captured turns")
	const restore = installFakeLlm()
	const domia = createIdentity()
	const sessionTraceId = randomUUID()
	const sessionId = randomUUID()
	dbClient
		.insert(interactionSessionTrace)
		.values({ id: sessionTraceId, domiaId: domia.id, sessionId })
		.run()
	try {
		for (const turn of CAPTURED_TURNS.filter((t) => t.language !== "es")) {
			const outcome = await reflectTurn(domia, sessionTraceId, sessionId, turn)
			checker.check(
				`${turn.label}: no model call and nothing stored`,
				outcome.calls === 0 && outcome.facts.length === 0,
				`calls=${outcome.calls} facts=${JSON.stringify(outcome.facts)}`,
			)
		}
		for (const turn of CONVERSATION_TURNS) {
			const outcome = await reflectTurn(domia, sessionTraceId, sessionId, turn)
			checker.check(
				`${turn.label}: still reflected and stored`,
				outcome.calls > 0 &&
					outcome.facts.some((f) => f.includes(turn.junk.value)),
				`calls=${outcome.calls} facts=${JSON.stringify(outcome.facts)}`,
			)
		}
		await checkMemoryWriteTurn(domia, sessionTraceId, sessionId)
	} finally {
		restore()
		destroyIdentity(domia)
	}
}

const main = async (): Promise<void> => {
	checkClassification()
	checkCaptureTable()
	await checkReflection()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} reflection-turns checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()

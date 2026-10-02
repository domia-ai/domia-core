import { randomUUID } from "crypto"

import { eq, like } from "drizzle-orm"

import {
	dbClient,
	domia as domiaTable,
	interactionSessionTrace,
	interactionTrace,
	pendingConfirmationRow,
	toolRun,
	turnEvent,
	INTENT_DECISION_ENUM,
	RESPONSE_TYPE_ENUM,
	BUILTIN_PROVIDER_ID_PREFIX,
	BUILTIN_PROVIDER_NAME,
	BUILTIN_PROVIDER_URL,
	MCP_TRANSPORT_ENUM,
	SKILL_PROTOCOL_ENUM,
	SKILL_TOOL_NAME_SEPARATOR,
	SKILL_TRUST_TIER_ENUM,
	type SelectSkillProviderType,
	type SkillToolType,
} from "@/db"
import {
	DOMIA_EVENT_BUS_ENUM,
	DOMIA_TURN_EVENT_ENUM,
	onTurnEvent,
	subscribeToDomiaBus,
	unsubscribeFromDomiaBus,
} from "@/buses"
import type { CoreBusContextType } from "@/modules/core-bus"
import { handlePendingConfirmation } from "@/modules/core-bus/controller/stt-done/confirmation"
import { registerHostedIdentity } from "@/modules/core"
import type { DomiaType } from "@/modules/core"
import {
	runAgentTurn,
	clearConfirmationsForDomia,
	confirmationScope,
	peekPendingConfirmation,
	ACT_BEFORE_CLAIM_NUDGE,
	type AgentResultType,
	type AgentTurnOptionsType,
} from "@/modules/agent"
import { delegatedAgentInference } from "@/modules/core-bus/controller/stt-done/skills-route"
import { setLocalService, type DeliverEventTarget } from "@/modules/grpc-client"
import { rejectFact } from "@/modules/memory"
import {
	callTool,
	connectProvider,
	disconnectProviders,
	getInvocationPolicy,
	getToolPolicy,
	resolveSkillArgs,
	setSkillRuntimePort,
	toolBaseName,
	type OriginCapabilitiesType,
	type SkillRuntimePortType,
} from "@/modules/skill-engine"
import { DOMIA_TOOLS } from "@/modules/skill-engine/specializations/domia/tools"
import type {
	DomiaNodeServiceImplementation,
	InferenceRequest,
	InferenceResponse,
} from "@/generated/proto/domia"
import { languageSetsFor, runWithTraceContext } from "@/utils"
import { baseLlmModelConfig, baseSkillProvider } from "@/test-utils/mocks"

import {
	HA_MCP_TOOLS,
	haProviderRow,
	makeChecker,
	mockEntityNames,
	sleep,
	startMockHa,
} from "./lib"
import type {
	DelegatedConfirmCaseType,
	DelegatedConfirmSampleType,
	DelegatedHubStubType,
	DelegatedStoredFactType,
} from "./types"

const checker = makeChecker()

const HUB_KEY = "DELEGATED_EVAL_HUB"
const HOME = "home-assistant"
const CONTEXT_WAIT_MS = 10_000
const FORGET_TOPIC = "the pantry"
const HOME_VERBS: Record<string, string> = {
	HassTurnOn: "turn on",
	HassTurnOff: "turn off",
	HassLockDoor: "lock",
	HassUnlockDoor: "unlock",
	HassOpenCover: "open",
	HassCloseCover: "close",
}
const DEFAULT_VERB = "handle"

const namespaced = (provider: string, tool: string): string =>
	`${provider}${SKILL_TOOL_NAME_SEPARATOR}${tool}`

const builtinToolsCache = (): SkillToolType[] =>
	DOMIA_TOOLS.map((tool) => ({
		provider: BUILTIN_PROVIDER_NAME,
		rawName: tool.name,
		namespacedName: namespaced(BUILTIN_PROVIDER_NAME, tool.name),
		description: tool.definition.description,
		inputSchema: tool.definition.inputSchema ?? {
			type: "object",
			properties: {},
		},
		...(tool.definition.annotations
			? { annotations: tool.definition.annotations }
			: {}),
	}))

const builtinProvider = (domiaId: string): SelectSkillProviderType => ({
	...baseSkillProvider(domiaId),
	id: `${BUILTIN_PROVIDER_ID_PREFIX}${domiaId}`,
	name: BUILTIN_PROVIDER_NAME,
	protocol: SKILL_PROTOCOL_ENUM.BUILTIN,
	type: MCP_TRANSPORT_ENUM.HTTP,
	url: BUILTIN_PROVIDER_URL,
	trustTier: SKILL_TRUST_TIER_ENUM.TRUSTED,
	descriptor: { version: 1, kind: BUILTIN_PROVIDER_NAME },
	toolsCache: builtinToolsCache(),
	priority: 0,
})

const domiaFor = (language: string): DomiaType => {
	const id = randomUUID()
	return {
		id,
		domiaKey: `DELEGATED_EVAL_${language.toUpperCase()}_${id.slice(0, 8)}`,
		characterProfile: { name: "Sous", language },
		llmModelConfig: { ...baseLlmModelConfig(id), fastPathEnabled: false },
		moduleSettings: null,
		runtimeCapabilities: null,
	} as unknown as DomiaType
}

const origin: OriginCapabilitiesType = {
	source: "local",
	satelliteId: null,
	satelliteProtocol: null,
	connected: true,
	canSpeak: true,
	canAnnounce: true,
	canFollowUp: true,
	canConfirm: true,
	timerNative: false,
	volumeNative: false,
	localPlayback: true,
}

const store = {
	domias: new Map<string, DomiaType>(),
	facts: [] as DelegatedStoredFactType[],
	expired: [] as string[],
	reflectionClaims: [] as string[],
}

const canonicalSubject = (subject: string): string =>
	subject === "user" ? "the user" : subject

const port = {
	domiaOf: (domiaId: string) =>
		Promise.resolve(store.domias.get(domiaId) ?? null),
	originCapabilities: () => origin,
	announceTarget: () => ({ kind: "local" }),
	facts: {
		upsert: (
			domia: DomiaType,
			fact: { subject: string; relation: string; value: string },
		) => {
			const subject = canonicalSubject(fact.subject)
			const reason = rejectFact(
				subject,
				fact.relation,
				fact.value,
				languageSetsFor(domia.characterProfile?.language).stopwords,
			)
			if (reason) return Promise.resolve({ written: false, reason })
			store.facts.push({
				subject,
				relation: fact.relation,
				value: fact.value,
			})
			return Promise.resolve({ written: true, reason: null })
		},
		expire: (_domia: DomiaType, what: string) => {
			store.expired.push(what)
			return Promise.resolve(1)
		},
	},
	memory: {
		markReflectionCaptured: (interactionId: string) => {
			store.reflectionClaims.push(interactionId)
		},
	},
} as unknown as SkillRuntimePortType

const hub: DelegatedHubStubType = { requests: [], responses: [] }

const hubService = {
	runInferenceWithTools: (
		request: InferenceRequest,
	): Promise<InferenceResponse> => {
		hub.requests.push(request)
		return Promise.resolve(hub.responses.shift() ?? { reply: "(exhausted)" })
	},
} as unknown as DomiaNodeServiceImplementation

const hubTarget: DeliverEventTarget = {
	domiaKey: HUB_KEY,
	domiaId: "delegated-eval-hub",
	localIp: "127.0.0.1",
	grpcPort: 1,
	grpcTls: false,
	source: "explicit",
	streamingCapabilities: { stt: true, llm: true, tts: true },
}

const toolCall = (
	name: string,
	args: Record<string, unknown>,
): InferenceResponse => ({
	toolCallsJson: JSON.stringify([{ name, arguments: args }]),
})

const delegatedTurn = async (
	domia: DomiaType,
	tools: SkillToolType[],
	transcript: string,
	responses: InferenceResponse[],
	opts: AgentTurnOptionsType = {},
): Promise<{ result: AgentResultType; events: string[] }> => {
	hub.requests = []
	hub.responses = [...responses]
	clearConfirmationsForDomia(domia.domiaKey)
	const interactionId = randomUUID()
	const events: string[] = []
	const unsubscribe = onTurnEvent({}, (event) => {
		if (
			event.type === DOMIA_TURN_EVENT_ENUM.TOOL_REQUESTED ||
			event.type === DOMIA_TURN_EVENT_ENUM.TOOL_RESULT
		)
			events.push(`${event.type}:${event.toolName}`)
	})
	try {
		const result = await runWithTraceContext(
			{ interactionId, originDomiaKey: domia.domiaKey },
			() =>
				runAgentTurn(
					domia,
					transcript,
					tools,
					delegatedAgentInference(domia.domiaKey, hubTarget, {
						originDomiaKey: domia.domiaKey,
						interactionId,
					}),
					{ voice: true, ...opts },
				),
		)
		await sleep(30)
		return { result, events }
	} finally {
		unsubscribe()
	}
}

const waitForHomeContext = async (domiaId: string): Promise<boolean> => {
	const deadline = Date.now() + CONTEXT_WAIT_MS
	const probe = namespaced(HOME, "HassTurnOn")
	while (Date.now() < deadline) {
		const resolved = await resolveSkillArgs(domiaId, probe, {
			name: mockEntityNames()[0],
		}).catch(() => null)
		if (resolved?.ok) return true
		await sleep(200)
	}
	return false
}

const confirmCasesOf = async (
	domia: DomiaType,
	tools: SkillToolType[],
): Promise<DelegatedConfirmCaseType[]> => {
	const cases: DelegatedConfirmCaseType[] = []
	for (const tool of tools) {
		const properties = Object.keys(tool.inputSchema.properties ?? {})
		const samples: DelegatedConfirmSampleType[] = properties.includes("name")
			? mockEntityNames().map((name) => ({ target: name, args: { name } }))
			: properties.includes("what")
				? [{ target: FORGET_TOPIC, args: { what: FORGET_TOPIC } }]
				: [{ target: "", args: {} }]
		const alwaysConfirms =
			getToolPolicy(domia.id, tool.namespacedName) === "confirm"
		for (const { target, args } of samples) {
			const resolved = await resolveSkillArgs(
				domia.id,
				tool.namespacedName,
				args,
			).catch(() => null)
			const confirms =
				alwaysConfirms ||
				(resolved?.ok === true &&
					getInvocationPolicy(
						domia.id,
						tool.namespacedName,
						resolved.resolvedArgs,
					).policy === "confirm")
			if (!confirms) continue
			cases.push({
				tool: tool.namespacedName,
				args,
				transcript:
					`${HOME_VERBS[tool.rawName] ?? DEFAULT_VERB} ${target}`.trim(),
			})
		}
	}
	return cases
}

const checkConfirmPolicy = async (
	domia: DomiaType,
	tools: SkillToolType[],
): Promise<void> => {
	console.log("\nconfirm policy holds for every tool on the delegated route")
	const cases = await confirmCasesOf(domia, tools)
	const covered = new Set(cases.map((c) => toolBaseName(c.tool)))
	checker.check(
		"the confirm set includes the built-in forget and Home Assistant writes on a lock",
		covered.has("forget") &&
			cases.some((c) =>
				c.tool.startsWith(`${HOME}${SKILL_TOOL_NAME_SEPARATOR}`),
			),
		`covered=${[...covered].join(",")}`,
	)
	const scope = confirmationScope(domia.domiaKey, undefined)
	let parked = 0
	for (const c of cases) {
		store.expired = []
		const { result, events } = await delegatedTurn(domia, tools, c.transcript, [
			toolCall(c.tool, c.args),
			{ reply: "Done." },
		])
		const ran =
			result.toolNamesUsed.includes(c.tool) ||
			result.skillResponses.some(
				(e) => e.kind === "result" && e.tool === c.tool && e.status === "ok",
			) ||
			events.some((e) => e.endsWith(`:${c.tool}`)) ||
			store.expired.length > 0
		const pending = peekPendingConfirmation(scope)
		if (result.stopReason === "confirm_required" && pending?.tool === c.tool)
			parked++
		checker.check(
			`${toolBaseName(c.tool)} ${JSON.stringify(c.args)} never runs unconfirmed (${result.stopReason})`,
			!ran,
			`used=${result.toolNamesUsed.join(",")} events=${events.join(",")} reply=${JSON.stringify(result.reply)}`,
		)
	}
	checker.check(
		"the delegated tool calls were parked as pending confirmations",
		parked > 0 && parked >= covered.size,
		`parked=${parked} cases=${cases.length} tools=${covered.size}`,
	)

	const forget = namespaced(BUILTIN_PROVIDER_NAME, "forget")
	const { result } = await delegatedTurn(
		domia,
		tools,
		"Forget what I said about the pantry.",
		[toolCall("forget", { what: FORGET_TOPIC })],
	)
	const pending = peekPendingConfirmation(scope)
	checker.check(
		"forget asked through the hub parks its confirmation on the origin",
		result.stopReason === "confirm_required" &&
			pending?.tool === forget &&
			store.expired.length === 0 &&
			/go ahead/i.test(result.reply),
		`stop=${result.stopReason} pending=${pending?.tool} reply=${JSON.stringify(result.reply)}`,
	)
	checker.check(
		"the hub only inferred: origin and interaction travel with the request",
		hub.requests.length === 1 &&
			hub.requests[0].originDomiaKey === domia.domiaKey &&
			hub.requests[0].targetDomiaKey === HUB_KEY,
		JSON.stringify(
			hub.requests.map((r) => [r.originDomiaKey, r.targetDomiaKey]),
		),
	)
}

const checkConfirmedReply = async (
	domia: DomiaType,
	tools: SkillToolType[],
): Promise<void> => {
	console.log("\na confirmed tool runs on the origin and speaks its own result")
	store.expired = []
	await delegatedTurn(domia, tools, "Forget what I said about the pantry.", [
		toolCall("forget", { what: FORGET_TOPIC }),
	])
	const sessionTraceId = randomUUID()
	const sessionId = randomUUID()
	const interactionId = randomUUID()
	dbClient
		.insert(interactionSessionTrace)
		.values({ id: sessionTraceId, domiaId: domia.id, sessionId })
		.run()
	dbClient
		.insert(interactionTrace)
		.values({
			id: interactionId,
			domiaId: domia.id,
			interactionSessionTraceId: sessionTraceId,
			sessionId,
		})
		.run()
	const replies: string[] = []
	const onReply = (payload: { reply: string }): void =>
		void replies.push(payload.reply)
	subscribeToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, onReply)
	try {
		const handled = await runWithTraceContext(
			{ interactionId, originDomiaKey: domia.domiaKey },
			() =>
				handlePendingConfirmation(
					{ domia } as CoreBusContextType,
					{
						transcript: "Yes.",
						interactionId,
						originDomiaKey: domia.domiaKey,
						responseType: RESPONSE_TYPE_ENUM.VOICE,
					},
					interactionId,
					"Yes.",
					domia.domiaKey,
				),
		)
		await sleep(50)
		const trace = dbClient
			.select()
			.from(interactionTrace)
			.where(eq(interactionTrace.id, interactionId))
			.get()
		checker.check(
			"yes runs the parked forget once, on the origin",
			handled &&
				store.expired.length === 1 &&
				store.expired[0] === FORGET_TOPIC &&
				peekPendingConfirmation(
					confirmationScope(domia.domiaKey, undefined),
				) === null,
			`handled=${handled} expired=${JSON.stringify(store.expired)}`,
		)
		checker.check(
			"the spoken reply is the tool's own sentence",
			replies.length === 1 && replies[0] === "Done, I've forgotten that.",
			JSON.stringify(replies),
		)
		checker.check(
			"the settle turn keeps its reply and its kind in the trace",
			trace?.llmResponse === "Done, I've forgotten that." &&
				trace.intentDecision ===
					`${INTENT_DECISION_ENUM.CONFIRMATION}:approved` &&
				trace.toolCallCount === 1,
			`llmResponse=${JSON.stringify(trace?.llmResponse)} intent=${trace?.intentDecision} tools=${trace?.toolCallCount}`,
		)
	} finally {
		unsubscribeFromDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, onReply)
		dbClient
			.delete(interactionTrace)
			.where(eq(interactionTrace.id, interactionId))
			.run()
		dbClient
			.delete(interactionSessionTrace)
			.where(eq(interactionSessionTrace.id, sessionTraceId))
			.run()
	}
}

const checkClaims = async (
	domia: DomiaType,
	tools: SkillToolType[],
): Promise<void> => {
	console.log("\nan action is never claimed without its tool call")
	const forget = namespaced(BUILTIN_PROVIDER_NAME, "forget")
	const claim = "I forgot what you said about the pantry."
	const expected = { expectedTools: [forget] }
	const scope = confirmationScope(domia.domiaKey, undefined)
	const phrases = languageSetsFor("en").phrases

	store.expired = []
	const nudged = await delegatedTurn(
		domia,
		tools,
		"Forget what I said about the pantry.",
		[{ reply: claim }, toolCall("forget", { what: FORGET_TOPIC })],
		expected,
	)
	const nudge = ACT_BEFORE_CLAIM_NUDGE.replace("{tools}", "forget")
	checker.check(
		"a claimed forget is sent back to the hub with the tool named",
		hub.requests.length === 2 && hub.requests[1].messagesJson.includes(nudge),
		`requests=${hub.requests.length}`,
	)
	checker.check(
		"the retried call is confirmed before anything is forgotten",
		nudged.result.stopReason === "confirm_required" &&
			peekPendingConfirmation(scope)?.tool === forget &&
			store.expired.length === 0,
		`stop=${nudged.result.stopReason} expired=${store.expired.length}`,
	)

	const stubborn = await delegatedTurn(
		domia,
		tools,
		"Forget what I said about the pantry.",
		[{ reply: claim }, { reply: claim }],
		expected,
	)
	checker.check(
		"a model that keeps claiming is replaced by an honest answer",
		stubborn.result.reply === phrases.cantDoThat &&
			stubborn.result.stopReason === "no_tool_call" &&
			stubborn.result.toolNamesUsed.length === 0 &&
			store.expired.length === 0,
		`reply=${JSON.stringify(stubborn.result.reply)} stop=${stubborn.result.stopReason}`,
	)

	const question = "Which topic should I forget?"
	const asked = await delegatedTurn(
		domia,
		tools,
		"Forget what I said.",
		[{ reply: claim }, { reply: question }],
		expected,
	)
	checker.check(
		"a question back to the user is not a claim and is spoken",
		asked.result.reply === question,
		JSON.stringify(asked.result.reply),
	)

	const askedFirst = await delegatedTurn(
		domia,
		tools,
		"Forget what I said.",
		[{ reply: question }],
		expected,
	)
	checker.check(
		"a question on the first answer is spoken without sending the turn back",
		askedFirst.result.reply === question && hub.requests.length === 1,
		`reply=${JSON.stringify(askedFirst.result.reply)} requests=${hub.requests.length}`,
	)

	const chat = await delegatedTurn(domia, tools, "Good morning to you.", [
		{ reply: "Wonderful, thank you." },
	])
	checker.check(
		"a turn with no expected tool keeps its first answer",
		chat.result.reply === "Wonderful, thank you." && hub.requests.length === 1,
		`reply=${JSON.stringify(chat.result.reply)} requests=${hub.requests.length}`,
	)

	const leaked = await delegatedTurn(
		domia,
		tools,
		"Tell me a short bedtime story about a dragon.",
		[
			{
				reply:
					'Here is a story about a dragon. {"name":"time","parameters":{}}',
			},
			{ reply: "Once upon a time a dragon made a friend." },
		],
	)
	checker.check(
		"the no-tool retry reaches the hub as tool_choice none",
		leaked.result.reply === "Once upon a time a dragon made a friend." &&
			hub.requests.length === 2 &&
			hub.requests[0].toolChoice === undefined &&
			hub.requests[1].toolChoice === "none",
		`choices=${JSON.stringify(hub.requests.map((r) => r.toolChoice))} reply=${JSON.stringify(leaked.result.reply)}`,
	)
}

const checkRemember = async (
	domia: DomiaType,
	tools: SkillToolType[],
	spanish: DomiaType,
): Promise<void> => {
	console.log("\nremember writes on the origin whatever subject the hub chose")
	store.facts = []
	const claimsBefore = store.reflectionClaims.length
	const allergy = await delegatedTurn(
		domia,
		tools,
		"Remember that I am allergic to cilantro.",
		[
			toolCall("remember", {
				subject: "you",
				relation: "is allergic to",
				value: "cilantro",
			}),
		],
		{ expectedTools: [namespaced(BUILTIN_PROVIDER_NAME, "remember")] },
	)
	checker.check(
		'subject "you" is stored as a fact about the user',
		allergy.result.reply === "Got it, I'll remember that." &&
			store.facts.some(
				(f) =>
					f.subject === "the user" &&
					f.relation === "is allergic to" &&
					f.value === "cilantro",
			),
		`reply=${JSON.stringify(allergy.result.reply)} facts=${JSON.stringify(store.facts)} trace=${JSON.stringify(allergy.result.skillResponses)}`,
	)
	checker.check(
		"the successful write leaves its turn open for reflection",
		store.reflectionClaims.length === claimsBefore,
	)

	store.facts = []
	const pantry = await delegatedTurn(
		domia,
		tools,
		"Remember that the pantry always has rice and lentils.",
		[
			toolCall("remember", {
				subject: "pantry",
				relation: "has",
				value: "rice and lentils",
			}),
		],
	)
	checker.check(
		"a thing the user owns is folded into the relation of a user fact",
		pantry.result.reply === "Got it, I'll remember that." &&
			store.facts.some(
				(f) =>
					f.subject === "the user" &&
					f.relation === "has pantry that has" &&
					f.value === "rice and lentils",
			),
		`reply=${JSON.stringify(pantry.result.reply)} facts=${JSON.stringify(store.facts)}`,
	)

	store.facts = []
	const command = await delegatedTurn(
		domia,
		tools,
		"Remember that I asked for the lights.",
		[
			toolCall("remember", {
				subject: "user",
				relation: "asked for",
				value: "the lights",
			}),
		],
	)
	checker.check(
		"a relation that is not a state is still refused, honestly",
		command.result.reply === "I couldn't keep that as a fact about you." &&
			store.facts.length === 0,
		`reply=${JSON.stringify(command.result.reply)} facts=${JSON.stringify(store.facts)}`,
	)

	store.facts = []
	const viaSpanish = await runWithTraceContext(
		{ originDomiaKey: spanish.domiaKey },
		() =>
			callTool(
				spanish.id,
				namespaced(BUILTIN_PROVIDER_NAME, "remember"),
				{ subject: "Tú", relation: "likes", value: "té verde" },
				undefined,
				true,
			),
	)
	checker.check(
		"es: the speaker words of the language are the user too",
		viaSpanish.status === "ok" &&
			store.facts.some(
				(f) => f.subject === "the user" && f.relation === "likes",
			),
		`got=${JSON.stringify(viaSpanish)} facts=${JSON.stringify(store.facts)}`,
	)
}

const insertRow = (domia: DomiaType): void => {
	dbClient
		.insert(domiaTable)
		.values({ id: domia.id, name: "delegated-eval", domiaKey: domia.domiaKey })
		.run()
}

const purgeRow = (domia: DomiaType): void => {
	dbClient
		.delete(pendingConfirmationRow)
		.where(like(pendingConfirmationRow.scope, `${domia.domiaKey}:%`))
		.run()
	dbClient.delete(turnEvent).where(eq(turnEvent.domiaId, domia.id)).run()
	dbClient.delete(toolRun).where(eq(toolRun.domiaId, domia.id)).run()
	dbClient.delete(domiaTable).where(eq(domiaTable.id, domia.id)).run()
}

const main = async (): Promise<void> => {
	const mock = await startMockHa(0)
	const domia = domiaFor("en")
	const spanish = domiaFor("es")
	store.domias.set(domia.id, domia)
	store.domias.set(spanish.id, spanish)
	insertRow(domia)
	insertRow(spanish)
	setSkillRuntimePort(port)
	registerHostedIdentity(HUB_KEY)
	setLocalService(hubService)
	const home = haProviderRow(mock.url, domia.id, HA_MCP_TOOLS)
	const builtin = builtinProvider(domia.id)
	const builtinEs = builtinProvider(spanish.id)
	try {
		const connected = await Promise.all([
			connectProvider(builtin, BUILTIN_PROVIDER_NAME, "en"),
			connectProvider(builtinEs, BUILTIN_PROVIDER_NAME, "es"),
			connectProvider(home, HOME, "en"),
		])
		checker.check(
			"built-in and Home Assistant providers connect on the origin",
			connected.every(Boolean) && (await waitForHomeContext(domia.id)),
		)
		const tools = [...(builtin.toolsCache ?? []), ...(home.toolsCache ?? [])]
		await checkConfirmPolicy(domia, tools)
		await checkConfirmedReply(domia, tools)
		await checkClaims(domia, tools)
		await checkRemember(domia, tools, spanish)
	} finally {
		clearConfirmationsForDomia(domia.domiaKey)
		await disconnectProviders([builtin.id, builtinEs.id, home.id])
		await mock.close()
		await sleep(100)
		purgeRow(domia)
		purgeRow(spanish)
	}
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} delegated-skills checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()

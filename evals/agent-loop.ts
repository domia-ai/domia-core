import { randomUUID } from "crypto"

import type { DomiaType } from "@/modules/core"
import type { SelectSkillProviderType, SkillToolType } from "@/db"
import { runAgentTurn } from "@/modules/agent"
import {
	peekPendingConfirmation,
	clearConfirmationsForDomia,
	confirmationScope,
} from "@/modules/agent"
import { connectProvider, disconnectProviders } from "@/modules/skill-engine"
import type { AgentInferenceType } from "@/modules/agent"
import type { ToolCallOrReplyType } from "@/modules/llm-engine"
import { baseLlmModelConfig } from "@/test-utils/mocks/llm-model-config"

import { startMockHa, makeChecker } from "./lib"
import { onTurnEvent } from "@/buses"
import { runWithTraceContext } from "@/utils"

const checker = makeChecker()

const DOMIA_ID = randomUUID()
const DOMIA_KEY = "AGENT_LOOP_TEST"
const SLUG = "mock"

const TOOLS_CACHE: SkillToolType[] = [
	{
		provider: SLUG,
		rawName: "GetLiveContext",
		namespacedName: `${SLUG}__GetLiveContext`,
		description: "Reads current state.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		provider: SLUG,
		rawName: "HassLockDoor",
		namespacedName: `${SLUG}__HassLockDoor`,
		description: "Locks a door.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				level: { type: "number" },
			},
			required: ["name"],
		},
	},
]

const providerCfg = (url: string): SelectSkillProviderType =>
	({
		id: randomUUID(),
		name: "mock",
		isActive: true,
		domiaId: DOMIA_ID,
		protocol: "mcp",
		type: "http",
		url,
		description: null,
		config: null,
		descriptor: {
			version: 1,
			execution: {
				toolPolicy: { HassLockDoor: "confirm" },
				toolHints: { GetLiveContext: { readOnlyHint: true } },
			},
		},
		auth: null,
		toolsCache: TOOLS_CACHE,
		toolWhitelist: null,
		lastSyncAt: null,
		maxResultChars: 4000,
		timeout: 3000,
		priority: 0,
		trustTier: "untrusted",
		createdAt: "",
		updatedAt: "",
	}) as SelectSkillProviderType

const domia = {
	id: DOMIA_ID,
	domiaKey: DOMIA_KEY,
	characterProfile: { language: "en" },
	llmModelConfig: baseLlmModelConfig(DOMIA_ID),
} as unknown as DomiaType

const scripted = (steps: ToolCallOrReplyType[]): AgentInferenceType => {
	let i = 0
	return () =>
		Promise.resolve(
			steps[Math.min(i++, steps.length - 1)] ?? {
				kind: "reply",
				text: "(exhausted)",
			},
		)
}

const scope = confirmationScope(DOMIA_KEY, undefined)

const main = async (): Promise<void> => {
	const mock = await startMockHa(0)
	const cfg = providerCfg(mock.url)
	const connected = await connectProvider(cfg, SLUG, "en")
	checker.check("mock provider connects", connected)

	console.log("\nmixed batch: normal call + confirmable call")
	clearConfirmationsForDomia(DOMIA_KEY)
	const emitted: string[] = []
	const unsubscribe = onTurnEvent({}, (event) => {
		if (event.type === "tool.requested" || event.type === "tool.result")
			emitted.push(event.type)
	})
	const mixed = await runWithTraceContext(
		{ interactionId: randomUUID(), originDomiaKey: DOMIA_KEY },
		() =>
			runAgentTurn(
				domia,
				"check the house and lock the front door",
				TOOLS_CACHE,
				scripted([
					{
						kind: "tool_calls",
						calls: [
							{ name: `${SLUG}__GetLiveContext`, arguments: {} },
							{
								name: `${SLUG}__HassLockDoor`,
								arguments: { name: "front door" },
							},
						],
					},
				]),
				{},
			),
	)
	await new Promise((r) => setTimeout(r, 50))
	unsubscribe()
	checker.check(
		"no tool.requested or tool.result events for a parked batch",
		emitted.length === 0,
		`emitted=${emitted.join(",")}`,
	)
	checker.check(
		"mixed batch parks the confirmable call",
		mixed.stopReason === "confirm_required",
	)
	checker.check(
		"no sibling is counted as used before confirmation",
		mixed.toolNamesUsed.length === 0,
		`used=${mixed.toolNamesUsed.join(",")}`,
	)
	checker.check(
		"no sibling result entries exist",
		!mixed.skillResponses.some((e) => e.kind === "result"),
	)
	const parkedMixed = peekPendingConfirmation(scope)
	checker.check(
		"pending confirmation holds the lock tool",
		parkedMixed?.tool === `${SLUG}__HassLockDoor`,
	)

	console.log("\nconfirmable call with unparseable args")
	clearConfirmationsForDomia(DOMIA_KEY)
	const invalid = await runAgentTurn(
		domia,
		"lock the door",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{
						name: `${SLUG}__HassLockDoor`,
						arguments: {},
						argsInvalid: true,
					},
				],
			},
			{ kind: "reply", text: "I could not parse that." },
		]),
		{},
	)
	checker.check(
		"argsInvalid confirmable is never parked",
		peekPendingConfirmation(scope) === null,
	)
	checker.check(
		"turn ends as a normal reply after repair guidance",
		invalid.stopReason === "completed" && invalid.reply.length > 0,
	)

	console.log("\nconfirmable call missing required args twice")
	clearConfirmationsForDomia(DOMIA_KEY)
	const missing = await runAgentTurn(
		domia,
		"lock it",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [{ name: `${SLUG}__HassLockDoor`, arguments: {} }],
			},
			{
				kind: "tool_calls",
				calls: [{ name: `${SLUG}__HassLockDoor`, arguments: {} }],
			},
			{ kind: "reply", text: "I need to know which door." },
		]),
		{},
	)
	checker.check(
		"incomplete confirmable is never parked (argCorrected loophole closed)",
		peekPendingConfirmation(scope) === null,
	)
	checker.check(
		"missing-args turn resolves to a reply",
		missing.stopReason === "completed",
	)

	console.log("\ncoerced args are preserved in the parked confirmation")
	clearConfirmationsForDomia(DOMIA_KEY)
	await runAgentTurn(
		domia,
		"lock the front door at level forty",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{
						name: `${SLUG}__HassLockDoor`,
						arguments: { name: "front door", level: "40" },
					},
				],
			},
		]),
		{},
	)
	const parkedCoerced = peekPendingConfirmation(scope)
	checker.check(
		"parked confirmation exists for coercion case",
		parkedCoerced?.tool === `${SLUG}__HassLockDoor`,
	)
	checker.check(
		"string number was coerced before parking",
		parkedCoerced?.resolvedArgs?.level === 40,
		`level=${JSON.stringify(parkedCoerced?.resolvedArgs?.level)}`,
	)

	console.log("\nauthored say replaces the finalize inference when enabled")
	clearConfirmationsForDomia(DOMIA_KEY)
	const authoredDomia = {
		...domia,
		llmModelConfig: {
			...domia.llmModelConfig,
			authoredSpeechEnabled: true,
		},
	} as unknown as DomiaType
	const authoredScript: ToolCallOrReplyType[] = [
		{
			kind: "tool_calls",
			calls: [{ name: `${SLUG}__GetLiveContext`, arguments: {} }],
			say: "Kitchen light is on.",
		},
		{ kind: "reply", text: "(finalize inference ran)" },
	]
	const authored = await runAgentTurn(
		authoredDomia,
		"turn on the kitchen light",
		TOOLS_CACHE,
		scripted(authoredScript),
		{},
	)
	checker.check(
		"authored say becomes the reply without a finalize inference",
		authored.reply === "Kitchen light is on." &&
			authored.finalizeMode === "authored" &&
			authored.steps === 1,
		`reply="${authored.reply}" mode=${authored.finalizeMode} steps=${authored.steps}`,
	)
	const unauthored = await runAgentTurn(
		domia,
		"turn on the kitchen light",
		TOOLS_CACHE,
		scripted(authoredScript),
		{},
	)
	checker.check(
		"authored say is ignored when the flag is off",
		unauthored.reply === "(finalize inference ran)" &&
			unauthored.finalizeMode === "agent_loop",
		`reply="${unauthored.reply}" mode=${unauthored.finalizeMode}`,
	)

	clearConfirmationsForDomia(DOMIA_KEY)
	await disconnectProviders([cfg.id])
	await mock.close()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} agent-loop checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()

import { randomUUID } from "crypto"
import { createServer, type Server } from "http"

import type { DomiaType } from "@/modules/core"
import type { SelectSkillProviderType, SkillToolType } from "@/db"
import { runAgentTurn, runAgentStep, createTurnContext } from "@/modules/agent"
import {
	peekPendingConfirmation,
	clearConfirmationsForDomia,
	confirmationScope,
} from "@/modules/agent"
import {
	connectProvider,
	disconnectProviders,
	listTools,
	providerStatuses,
	effectiveHints,
	deriveRiskClass,
	deriveDefaultPolicy,
} from "@/modules/skill-engine"
import type { AgentInferenceType } from "@/modules/agent"
import type {
	ToolCallOrReplyType,
	ToolDefinitionType,
} from "@/modules/llm-engine"
import { runLLMWithTools } from "@/modules/llm-engine"
import { LLM_ENGINE_ENUM } from "@/db"
import { baseLlmModelConfig } from "@/test-utils/mocks/llm-model-config"

import { startMockHa, startMockMusic, makeChecker } from "./lib"
import { DOMIA_TURN_EVENT_ENUM, onTurnEvent } from "@/buses"
import {
	runWithTraceContext,
	isDomiaError,
	toError,
	AGENT_ERRORS,
	LLM_ERRORS,
} from "@/utils"

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
		rawName: "HassTurnOn",
		namespacedName: `${SLUG}__HassTurnOn`,
		description: "Turns on a device.",
		inputSchema: {
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
		},
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

const providerCfg = (url: string): SelectSkillProviderType => ({
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
			toolHints: {
				GetLiveContext: { readOnlyHint: true },
				HassTurnOn: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: true,
				},
			},
		},
	},
	serverDescriptor: null,
	serverDescriptorHash: null,
	auth: null,
	toolsCache: TOOLS_CACHE,
	toolWhitelist: null,
	lastSyncAt: null,
	maxResultChars: 4000,
	timeout: 3000,
	toolsRefreshMs: 300_000,
	priority: 0,
	trustTier: "untrusted",
	createdAt: "",
	updatedAt: "",
})

const domia = {
	id: DOMIA_ID,
	domiaKey: DOMIA_KEY,
	characterProfile: { name: "Domia", language: "en" },
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

const PLAIN_SLUG = "plain"

const PLAIN_TOOLS: SkillToolType[] = [
	{
		provider: PLAIN_SLUG,
		rawName: "NoteRead",
		namespacedName: `${PLAIN_SLUG}__NoteRead`,
		description: "Reads the text of a note.",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		provider: PLAIN_SLUG,
		rawName: "NoteDelete",
		namespacedName: `${PLAIN_SLUG}__NoteDelete`,
		description: "Permanently deletes a note.",
		inputSchema: { type: "object", properties: {} },
		annotations: { destructiveHint: true, openWorldHint: false },
	},
	{
		provider: PLAIN_SLUG,
		rawName: "NotePublish",
		namespacedName: `${PLAIN_SLUG}__NotePublish`,
		description: "Publishes a note to the public web board.",
		inputSchema: { type: "object", properties: {} },
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
	},
]

const plainCfg = (
	url: string,
	trustTier: string,
	descriptor: unknown = null,
): SelectSkillProviderType =>
	({
		...providerCfg(url),
		id: randomUUID(),
		name: `plain-${trustTier}`,
		descriptor,
		trustTier,
		toolsCache: PLAIN_TOOLS,
	}) as SelectSkillProviderType

const plainStatuses = async (
	cfg: SelectSkillProviderType,
): Promise<
	Map<string, { riskClass: string; policy: string; policySource: string }>
> => {
	await connectProvider(cfg, PLAIN_SLUG, "en")
	const [status] = providerStatuses({
		...domia,
		skillProviders: [cfg],
	})
	await disconnectProviders([cfg.id])
	return new Map(
		status.tools.map((t) => [
			t.rawName,
			{
				riskClass: t.riskClass,
				policy: t.policy,
				policySource: t.policySource,
			},
		]),
	)
}

const checkPlainProviderTiers = async (url: string): Promise<void> => {
	console.log("\na plain MCP server (no specialization) at every trust tier")
	const standard = await plainStatuses(plainCfg(url, "standard"))
	checker.check(
		"standard: a destructive annotation asks first",
		standard.get("NoteDelete")?.policy === "confirm" &&
			standard.get("NoteDelete")?.riskClass === "write_destructive",
		JSON.stringify(standard.get("NoteDelete")),
	)
	checker.check(
		"standard: a read-only annotation is ignored and still asks first",
		standard.get("NoteRead")?.policy === "confirm" &&
			standard.get("NoteRead")?.riskClass === "write_destructive",
		JSON.stringify(standard.get("NoteRead")),
	)

	const relaxed = await plainStatuses(
		plainCfg(url, "standard", {
			version: 1,
			execution: {
				toolHints: {
					NotePublish: { destructiveHint: false },
					NoteRead: { readOnlyHint: true },
				},
			},
		}),
	)
	checker.check(
		"standard: an open-world write asks first even when the descriptor relaxes its risk",
		relaxed.get("NotePublish")?.riskClass === "write_additive" &&
			relaxed.get("NotePublish")?.policy === "confirm" &&
			relaxed.get("NotePublish")?.policySource === "risk_default",
		JSON.stringify(relaxed.get("NotePublish")),
	)
	checker.check(
		"standard: a descriptor read-only override relaxes a read to allow",
		relaxed.get("NoteRead")?.riskClass === "read" &&
			relaxed.get("NoteRead")?.policy === "allow",
		JSON.stringify(relaxed.get("NoteRead")),
	)

	const overridden = await plainStatuses(
		plainCfg(url, "standard", {
			version: 1,
			execution: { toolPolicy: { NotePublish: "allow" } },
		}),
	)
	checker.check(
		"standard: a descriptor toolPolicy override relaxes the open-world write",
		overridden.get("NotePublish")?.policy === "allow" &&
			overridden.get("NotePublish")?.policySource === "descriptor",
		JSON.stringify(overridden.get("NotePublish")),
	)

	const trusted = await plainStatuses(plainCfg(url, "trusted"))
	checker.check(
		"trusted: a read-only annotation is honored and allowed",
		trusted.get("NoteRead")?.riskClass === "read" &&
			trusted.get("NoteRead")?.policy === "allow",
		JSON.stringify(trusted.get("NoteRead")),
	)
	checker.check(
		"trusted: an open-world non-destructive write is allowed",
		trusted.get("NotePublish")?.riskClass === "write_additive" &&
			trusted.get("NotePublish")?.policy === "allow",
		JSON.stringify(trusted.get("NotePublish")),
	)
	checker.check(
		"trusted: a destructive annotation still asks first",
		trusted.get("NoteDelete")?.policy === "confirm",
		JSON.stringify(trusted.get("NoteDelete")),
	)

	const openWorldWrite = effectiveHints(
		{ readOnlyHint: false, destructiveHint: false, openWorldHint: true },
		{ destructiveHint: false },
		"standard",
	)
	checker.check(
		"policy layer: open-world confirms below trusted, allows at trusted",
		deriveDefaultPolicy(
			deriveRiskClass(openWorldWrite),
			openWorldWrite,
			"standard",
		) === "confirm" &&
			deriveDefaultPolicy(
				deriveRiskClass(openWorldWrite),
				openWorldWrite,
				"trusted",
			) === "allow",
	)
}

const PREFIXED_SLUG = "pfx"

const capturingInference = (
	steps: ToolCallOrReplyType[],
	seen: ToolDefinitionType[][],
): AgentInferenceType => {
	let i = 0
	return (_messages, tools) => {
		seen.push(tools)
		return Promise.resolve(
			steps[Math.min(i++, steps.length - 1)] ?? {
				kind: "reply",
				text: "(exhausted)",
			},
		)
	}
}

const resultTools = (result: { skillResponses: unknown[] }): string[] =>
	result.skillResponses
		.filter(
			(e): e is { kind: string; tool: string; status?: string } =>
				(e as { kind?: string }).kind === "result",
		)
		.map((e) => `${e.tool}:${e.status ?? ""}`)

const startFailingLlm = async (
	body: string,
): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
	const server: Server = createServer((_req, res) => {
		res.writeHead(500, { "content-type": "application/json" })
		res.end(body)
	})
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	const address = server.address()
	const port = typeof address === "object" && address ? address.port : 0
	return {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			}),
	}
}

const checkAbort = async (): Promise<void> => {
	console.log("\nan exhausted turn budget aborts the loop")
	const slow: AgentInferenceType = () =>
		new Promise((resolve) =>
			setTimeout(() => resolve({ kind: "reply", text: "too late" }), 60),
		)
	const aborted = await runAgentTurn(
		domia,
		"turn on the kitchen light",
		TOOLS_CACHE,
		slow,
		{ budgetMs: 1 },
	)
	checker.check(
		"a 1 ms budget stops the turn with stopReason aborted and no reply",
		aborted.stopReason === "aborted" &&
			aborted.reply === "" &&
			aborted.toolNamesUsed.length === 0,
		`stop=${aborted.stopReason} reply="${aborted.reply}" used=${aborted.toolNamesUsed.join(",")}`,
	)
}

const checkReadBeforeAnswer = async (): Promise<void> => {
	console.log("\na state question answered without a read is retried read-only")
	let calls = 0
	const guessThenRead: AgentInferenceType = () => {
		calls += 1
		const out: ToolCallOrReplyType =
			calls === 1
				? { kind: "reply", text: "It is off." }
				: {
						kind: "tool_calls",
						calls: [{ name: `${SLUG}__GetLiveContext`, arguments: {} }],
					}
		return Promise.resolve(out)
	}
	const result = await runAgentTurn(
		domia,
		"is the kitchen light on?",
		TOOLS_CACHE,
		guessThenRead,
	)
	checker.check(
		"the first plain answer triggers one read-only retry that calls the read tool",
		result.toolNamesUsed.some((n) => n.includes("GetLiveContext")) &&
			calls >= 2,
		`used=${result.toolNamesUsed.join(",")} calls=${calls} stop=${result.stopReason}`,
	)
	let plainCalls = 0
	const plainReply: AgentInferenceType = () => {
		plainCalls += 1
		return Promise.resolve({ kind: "reply", text: "Sure, doing it." })
	}
	const command = await runAgentTurn(
		domia,
		"turn on the kitchen light",
		TOOLS_CACHE,
		plainReply,
	)
	checker.check(
		"a plain answer to a command is not retried",
		plainCalls === 1 && command.reply === "Sure, doing it.",
		`calls=${plainCalls} reply="${command.reply}"`,
	)
}

const checkRetryCue = async (): Promise<void> => {
	console.log("\na retry request re-issues the last tool call")
	clearConfirmationsForDomia(DOMIA_KEY)
	const retryCall = {
		tool: `${SLUG}__HassTurnOn`,
		args: { name: "office light" },
	}
	let reissuedCalls = 0
	const replyOnly: AgentInferenceType = () => {
		reissuedCalls += 1
		return Promise.resolve({
			kind: "reply",
			text: "I tried it again.",
		} as ToolCallOrReplyType)
	}
	const reissued = await runAgentTurn(
		domia,
		"That didn't work — try it again please.",
		TOOLS_CACHE,
		replyOnly,
		{ retryCall },
	)
	checker.check(
		"a failed call in the recent window is re-issued without asking the model",
		reissued.toolNamesUsed.includes(`${SLUG}__HassTurnOn`) &&
			reissuedCalls <= 1,
		`used=${reissued.toolNamesUsed.join(",")} decisions=${reissuedCalls} stop=${reissued.stopReason}`,
	)
	let noRecentCalls = 0
	const noRecent = await runAgentTurn(
		domia,
		"That didn't work — try it again please.",
		TOOLS_CACHE,
		() => {
			noRecentCalls += 1
			return Promise.resolve({
				kind: "reply",
				text: "Sorry about that.",
			} as ToolCallOrReplyType)
		},
	)
	checker.check(
		"a retry cue with no recent call falls back to the normal decision",
		noRecent.toolNamesUsed.length === 0 &&
			noRecentCalls === 1 &&
			noRecent.reply === "Sorry about that.",
		`used=${noRecent.toolNamesUsed.join(",")} decisions=${noRecentCalls} reply="${noRecent.reply}"`,
	)
	const unrelated = await runAgentTurn(
		domia,
		"Tell me a joke about lamps",
		TOOLS_CACHE,
		() =>
			Promise.resolve({
				kind: "reply",
				text: "Here it is.",
			} as ToolCallOrReplyType),
		{ retryCall },
	)
	checker.check(
		"a recent call is not re-issued without a retry cue",
		unrelated.toolNamesUsed.length === 0,
		`used=${unrelated.toolNamesUsed.join(",")}`,
	)
}

const checkToolAliases = async (): Promise<void> => {
	console.log("\ndomain-prefixed tool names are advertised under short aliases")
	const prefixedMock = await startMockHa(0, { domainPrefixed: true })
	const prefixedCfg = {
		...providerCfg(prefixedMock.url),
		id: randomUUID(),
		name: "prefixed",
		toolsCache: null,
	} as SelectSkillProviderType
	await connectProvider(prefixedCfg, PREFIXED_SLUG, "en")
	const tools = await listTools({
		...domia,
		skillProviders: [prefixedCfg],
	})
	const context = `${PREFIXED_SLUG}__homeassistant__GetLiveContext`
	const turnOn = `${PREFIXED_SLUG}__intent__HassTurnOn`
	checker.check(
		"the prefixed server advertises double-namespaced tools",
		tools.some((t) => t.namespacedName === context) &&
			tools.some((t) => t.namespacedName === turnOn),
		tools.map((t) => t.namespacedName).join(","),
	)

	const runAliased = async (
		transcript: string,
		emitted: string,
		args: Record<string, unknown> = {},
	): Promise<{
		result: Awaited<ReturnType<typeof runAgentTurn>>
		advertised: string[]
	}> => {
		const seen: ToolDefinitionType[][] = []
		const result = await runAgentTurn(
			domia,
			transcript,
			tools,
			capturingInference(
				[
					{ kind: "tool_calls", calls: [{ name: emitted, arguments: args }] },
					{ kind: "reply", text: "Done." },
				],
				seen,
			),
			{},
		)
		return { result, advertised: (seen[0] ?? []).map((d) => d.name) }
	}

	const base = await runAliased("check the house", "GetLiveContext")
	checker.check(
		"tools are advertised to the model under their base names",
		base.advertised.includes("GetLiveContext") &&
			base.advertised.includes("HassTurnOn") &&
			!base.advertised.some((n) => n.includes("__")),
		base.advertised.join(","),
	)
	checker.check(
		"every advertised alias is unique",
		new Set(base.advertised).size === base.advertised.length,
		base.advertised.join(","),
	)
	checker.check(
		"a base-name tool call executes the namespaced tool",
		base.result.toolNamesUsed.join(",") === context,
		`used=${base.result.toolNamesUsed.join(",")}`,
	)
	checker.check(
		"the persisted trace keeps the namespaced name and the call succeeded",
		resultTools(base.result).join(",") === `${context}:ok`,
		resultTools(base.result).join(","),
	)

	const halfPrefixed = await runAliased(
		"check the house",
		`${PREFIXED_SLUG}__GetLiveContext`,
	)
	checker.check(
		"a provider-prefixed near-miss resolves to the namespaced tool",
		halfPrefixed.result.toolNamesUsed.join(",") === context,
		`used=${halfPrefixed.result.toolNamesUsed.join(",")}`,
	)

	const fullyQualified = await runAliased("check the house", context)
	checker.check(
		"the full namespaced name still resolves",
		fullyQualified.result.toolNamesUsed.join(",") === context,
		`used=${fullyQualified.result.toolNamesUsed.join(",")}`,
	)

	const domainOnly = await runAliased(
		"Turn on the kitchen light",
		"intent__HassTurnOn",
		{ name: "Kitchen Light" },
	)
	checker.check(
		"a domain-prefixed write resolves and runs the namespaced tool",
		domainOnly.result.toolNamesUsed.join(",") === turnOn,
		`used=${domainOnly.result.toolNamesUsed.join(",")}`,
	)

	const unknown = await runAliased("check the house", "HassLightGetState")
	checker.check(
		"an invented tool name stays unknown",
		unknown.result.toolNamesUsed.length === 0 &&
			unknown.result.reply === "Done.",
		`used=${unknown.result.toolNamesUsed.join(",")} reply="${unknown.result.reply}"`,
	)

	clearConfirmationsForDomia(DOMIA_KEY)
	const lock = await runAliased("lock the front door", "HassLockDoor", {
		name: "front door",
	})
	checker.check(
		"a base-keyed descriptor policy still applies to a prefixed tool",
		lock.result.stopReason === "confirm_required" &&
			peekPendingConfirmation(scope)?.tool ===
				`${PREFIXED_SLUG}__lock__HassLockDoor`,
		`stop=${lock.result.stopReason} parked=${peekPendingConfirmation(scope)?.tool}`,
	)
	clearConfirmationsForDomia(DOMIA_KEY)

	await disconnectProviders([prefixedCfg.id])
	await prefixedMock.close()
}

const checkGrammarRejection = async (): Promise<void> => {
	console.log("\na grammar rejection is the model's fault, not the engine's")
	const peg = await startFailingLlm(
		JSON.stringify({
			error: {
				code: 500,
				message:
					"The model produced output that does not match the expected peg-native format",
				type: "server_error",
			},
		}),
	)
	const pegDomia = {
		...domia,
		llmModelConfig: {
			...domia.llmModelConfig,
			engine: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
			baseUrl: peg.baseUrl,
			modelName: "test-model",
			toolModelName: null,
		},
	} as unknown as DomiaType
	let pegError: unknown = null
	try {
		await runLLMWithTools(pegDomia, [{ role: "user", content: "hi" }], [])
	} catch (error) {
		pegError = error
	}
	checker.check(
		"a peg-native 500 maps to an unparseable decision, not an engine failure",
		isDomiaError(pegError) &&
			pegError.code === AGENT_ERRORS.DECISION_UNPARSEABLE.code,
		isDomiaError(pegError) ? pegError.code : String(pegError),
	)

	const honest = await runAgentTurn(
		domia,
		"turn on the kitchen light",
		TOOLS_CACHE,
		() => Promise.reject(toError(pegError)),
		{},
	)
	checker.check(
		"the agent answers honestly instead of throwing into the chat fallback",
		honest.stopReason === "inference_error" && honest.reply.length > 0,
		`stop=${honest.stopReason} reply="${honest.reply}"`,
	)
	await peg.close()

	const broken = await startFailingLlm(
		JSON.stringify({
			error: { code: 500, message: "internal error", type: "server_error" },
		}),
	)
	const brokenDomia = {
		...domia,
		llmModelConfig: {
			...domia.llmModelConfig,
			engine: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
			baseUrl: broken.baseUrl,
			modelName: "test-model",
			toolModelName: null,
		},
	} as unknown as DomiaType
	let engineError: unknown = null
	try {
		await runLLMWithTools(brokenDomia, [{ role: "user", content: "hi" }], [])
	} catch (error) {
		engineError = error
	}
	checker.check(
		"an ordinary 500 is still an engine failure",
		isDomiaError(engineError) &&
			engineError.code === LLM_ERRORS.ENGINE_FAILED.code,
		isDomiaError(engineError) ? engineError.code : String(engineError),
	)
	let rethrown = false
	await runAgentTurn(
		domia,
		"turn on the kitchen light",
		TOOLS_CACHE,
		() => Promise.reject(toError(engineError)),
		{},
	).catch(() => {
		rethrown = true
	})
	checker.check(
		"an engine failure still falls through to the plain LLM",
		rethrown,
	)
	await broken.close()
}

const HA_SLUG = "ha"

const checkTargetlessWrites = async (): Promise<void> => {
	console.log(
		"\na write with no target is inferred from the utterance or asked",
	)
	const haMock = await startMockHa(0)
	const haCfg = {
		...providerCfg(haMock.url),
		id: randomUUID(),
		name: "home-assistant",
		descriptor: { version: 1, kind: "home-assistant" },
		toolsCache: null,
	} as unknown as SelectSkillProviderType
	await connectProvider(haCfg, HA_SLUG, "en")
	const turnOff = `${HA_SLUG}__HassTurnOff`
	const runTargetless = async (
		transcript: string,
		args: Record<string, unknown> = {},
	): Promise<Awaited<ReturnType<typeof runAgentTurn>>> =>
		runAgentTurn(
			domia,
			transcript,
			await listTools({ ...domia, skillProviders: [haCfg] }),
			scripted([
				{ kind: "tool_calls", calls: [{ name: turnOff, arguments: args }] },
				{ kind: "reply", text: "(follow-up)" },
			]),
			{},
		)
	const argsOfFirstCall = (result: {
		skillResponses: unknown[]
	}): Record<string, unknown> =>
		(result.skillResponses[0] as { args?: Record<string, unknown> } | undefined)
			?.args ?? {}

	const blanketLights = await runTargetless("Turn off all the lights please")
	checker.check(
		"a targetless turn-off with a domain word runs on the whole domain",
		blanketLights.toolNamesUsed.join(",") === turnOff &&
			JSON.stringify(argsOfFirstCall(blanketLights).domain) ===
				JSON.stringify(["light"]),
		`used=${blanketLights.toolNamesUsed.join(",")} args=${JSON.stringify(argsOfFirstCall(blanketLights))}`,
	)

	const blanketEverything = await runTargetless("Turn everything off")
	const everythingDomains = argsOfFirstCall(blanketEverything).domain
	checker.check(
		"an all-cue with no domain word covers every non-sensitive domain in context",
		blanketEverything.toolNamesUsed.join(",") === turnOff &&
			Array.isArray(everythingDomains) &&
			everythingDomains.includes("light") &&
			everythingDomains.includes("media_player") &&
			!everythingDomains.includes("lock"),
		`used=${blanketEverything.toolNamesUsed.join(",")} args=${JSON.stringify(argsOfFirstCall(blanketEverything))}`,
	)

	const noTarget = await runTargetless("Turn it off")
	checker.check(
		"a targetless write with nothing to infer asks instead of acting",
		noTarget.toolNamesUsed.length === 0 &&
			noTarget.reply === "(follow-up)" &&
			resultTools(noTarget).length === 0,
		`used=${noTarget.toolNamesUsed.join(",")} reply="${noTarget.reply}"`,
	)

	const inventedDomain = await runTargetless(
		"Set music level two hundred percent",
		{ domain: ["light"] },
	)
	checker.check(
		"a domain the user never spoke is replaced by the one they did speak",
		inventedDomain.toolNamesUsed.join(",") === turnOff &&
			JSON.stringify(argsOfFirstCall(inventedDomain).domain) ===
				JSON.stringify(["media_player"]),
		`used=${inventedDomain.toolNamesUsed.join(",")} args=${JSON.stringify(argsOfFirstCall(inventedDomain))}`,
	)

	const inventedOnly = await runTargetless("Set the level to two hundred", {
		domain: ["light"],
	})
	checker.check(
		"a domain the user never spoke with nothing else to go on is refused",
		inventedOnly.toolNamesUsed.length === 0 &&
			inventedOnly.reply === "(follow-up)" &&
			resultTools(inventedOnly).length === 0,
		`used=${inventedOnly.toolNamesUsed.join(",")} reply="${inventedOnly.reply}"`,
	)

	const spokenDomain = await runTargetless("Turn off the lights", {
		domain: ["light"],
	})
	checker.check(
		"a domain the user did speak stays the target",
		spokenDomain.toolNamesUsed.join(",") === turnOff &&
			JSON.stringify(argsOfFirstCall(spokenDomain).domain) ===
				JSON.stringify(["light"]),
		`used=${spokenDomain.toolNamesUsed.join(",")} args=${JSON.stringify(argsOfFirstCall(spokenDomain))}`,
	)

	const widenedDomain = await runTargetless("Turn off the lights", {
		domain: ["light", "switch"],
	})
	checker.check(
		"a domain list wider than what was spoken narrows to the spoken domain",
		widenedDomain.toolNamesUsed.join(",") === turnOff &&
			JSON.stringify(argsOfFirstCall(widenedDomain).domain) ===
				JSON.stringify(["light"]),
		`used=${widenedDomain.toolNamesUsed.join(",")} args=${JSON.stringify(argsOfFirstCall(widenedDomain))}`,
	)

	await disconnectProviders([haCfg.id])
	await haMock.close()
}

const MUSIC_SLUG = "music"

const MUSIC_WHITELIST = [
	"playback_pause",
	"playback_resume",
	"playback_next_track",
	"playback_previous_track",
	"volume_volume_set",
	"volume_volume_up",
	"volume_volume_down",
	"volume_volume_mute",
]

const maCfg = (url: string): SelectSkillProviderType => ({
	...providerCfg(url),
	id: randomUUID(),
	name: "music",
	descriptor: { version: 1, kind: "music-assistant" },
	toolsCache: null,
	toolWhitelist: MUSIC_WHITELIST,
	trustTier: "untrusted",
})

const checkTwoProviders = async (): Promise<void> => {
	console.log("\ntwo MCP providers serve one Domia at the same time")
	const haMock = await startMockHa(0)
	const musicMock = await startMockMusic()
	const haCfg = {
		...providerCfg(haMock.url),
		id: randomUUID(),
		name: "home-assistant",
		descriptor: { version: 1, kind: "home-assistant" },
		toolsCache: null,
	} as unknown as SelectSkillProviderType
	const musicCfg = maCfg(musicMock.url)
	await connectProvider(haCfg, HA_SLUG, "en")
	await connectProvider(musicCfg, MUSIC_SLUG, "en")
	const both = { ...domia, skillProviders: [haCfg, musicCfg] } as DomiaType
	const tools = await listTools(both)
	const namespaced = tools.map((t) => t.namespacedName)
	checker.check(
		"each provider keeps its own namespace in one tool list",
		namespaced.includes(`${HA_SLUG}__HassTurnOn`) &&
			namespaced.includes(`${MUSIC_SLUG}__playback_pause`) &&
			namespaced.includes(`${MUSIC_SLUG}__music_play`),
		namespaced.join(","),
	)
	const statuses = providerStatuses(both)
	const music = statuses.find((s) => s.name === "music")
	checker.check(
		"both providers report connected with their own specialization",
		statuses.length === 2 &&
			statuses.every((s) => s.connected) &&
			statuses.find((s) => s.name === "home-assistant")?.kind ===
				"home-assistant" &&
			music?.kind === "music-assistant",
		JSON.stringify(statuses.map((s) => [s.name, s.kind, s.connected])),
	)
	checker.check(
		"a tool outside the music whitelist is never registered",
		music?.tools.some((t) => t.rawName === "playback_pause") === true &&
			music.tools.every((t) => t.rawName !== "queue_clear_queue"),
		(music?.tools ?? []).map((t) => t.rawName).join(","),
	)
	await disconnectProviders([haCfg.id, musicCfg.id])
	await haMock.close()
	await musicMock.close()
}

const scope = confirmationScope(DOMIA_KEY, undefined)

const checkStepOutcomes = async (): Promise<void> => {
	console.log("\na single agent step reports its own outcome")
	clearConfirmationsForDomia(DOMIA_KEY)
	const replyCtx = createTurnContext(
		domia,
		"turn on the kitchen light",
		TOOLS_CACHE,
		scripted([{ kind: "reply", text: "Sure, doing it." }]),
		{},
	)
	const replyStep = await runAgentStep(replyCtx, 0)
	checker.check(
		"a plain reply to a command ends the step as reply in one step",
		replyStep.kind === "reply" &&
			replyStep.result.reply === "Sure, doing it." &&
			replyStep.result.steps === 1 &&
			replyStep.result.toolNamesUsed.length === 0,
		`kind=${replyStep.kind}`,
	)
	const confirmCtx = createTurnContext(
		domia,
		"lock the front door",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{
						name: `${SLUG}__HassLockDoor`,
						arguments: { name: "front door" },
					},
				],
			},
		]),
		{},
	)
	const confirmStep = await runAgentStep(confirmCtx, 0)
	const parked = peekPendingConfirmation(scope)
	checker.check(
		"a parked call ends the step as confirm_required with the confirmation stored",
		confirmStep.kind === "confirm_required" &&
			confirmStep.result.stopReason === "confirm_required" &&
			parked?.tool === `${SLUG}__HassLockDoor` &&
			parked.args.name === "front door",
		`kind=${confirmStep.kind} parked=${parked?.tool}`,
	)
	clearConfirmationsForDomia(DOMIA_KEY)
}

const main = async (): Promise<void> => {
	const mock = await startMockHa(0)
	const cfg = providerCfg(mock.url)
	const connected = await connectProvider(cfg, SLUG, "en")
	checker.check("mock provider connects", connected)

	console.log("\ntrust tier gates server-declared risk annotations")
	const readOnlyServer = { readOnlyHint: true }
	const trusted = effectiveHints(readOnlyServer, undefined, "trusted")
	const standard = effectiveHints(readOnlyServer, undefined, "standard")
	const untrusted = effectiveHints(readOnlyServer, undefined, "untrusted")
	checker.check(
		"trusted honors a risk-decreasing server annotation",
		trusted.readOnly === true && deriveRiskClass(trusted) === "read",
	)
	checker.check(
		"standard ignores a risk-decreasing server annotation",
		standard.readOnly === undefined &&
			deriveRiskClass(standard) === "write_destructive",
		`readOnly=${String(standard.readOnly)} risk=${deriveRiskClass(standard)}`,
	)
	checker.check(
		"untrusted ignores a risk-decreasing server annotation",
		untrusted.readOnly === undefined,
	)
	checker.check(
		"standard still honors a risk-increasing server annotation",
		effectiveHints({ destructiveHint: true }, undefined, "standard")
			.destructive === true,
	)
	checker.check(
		"descriptor override wins for standard regardless of tier",
		effectiveHints(readOnlyServer, { readOnlyHint: true }, "standard")
			.readOnly === true,
	)

	await checkPlainProviderTiers(mock.url)

	console.log("\nmixed batch: normal call + confirmable call")
	clearConfirmationsForDomia(DOMIA_KEY)
	const emitted: string[] = []
	const unsubscribe = onTurnEvent({}, (event) => {
		if (
			event.type === DOMIA_TURN_EVENT_ENUM.TOOL_REQUESTED ||
			event.type === DOMIA_TURN_EVENT_ENUM.TOOL_RESULT
		)
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

	console.log("\na write aimed at a device the user never mentioned is blocked")
	clearConfirmationsForDomia(DOMIA_KEY)
	const wrongTarget = await runAgentTurn(
		domia,
		"Turn on the office light",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{ name: `${SLUG}__HassTurnOn`, arguments: { name: "bedroom tv" } },
				],
			},
			{ kind: "reply", text: "I couldn't do that." },
		]),
		{},
	)
	checker.check(
		"target guard blocks the foreign device and never executes it",
		wrongTarget.toolNamesUsed.length === 0 &&
			wrongTarget.reply === "I couldn't do that.",
		`used=${wrongTarget.toolNamesUsed.join(",")} reply="${wrongTarget.reply}"`,
	)
	const rightTarget = await runAgentTurn(
		domia,
		"Turn on the office light",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{ name: `${SLUG}__HassTurnOn`, arguments: { name: "office light" } },
				],
			},
			{ kind: "reply", text: "Done." },
		]),
		{},
	)
	checker.check(
		"target guard lets the mentioned device through",
		rightTarget.toolNamesUsed.join(",") === `${SLUG}__HassTurnOn`,
		`used=${rightTarget.toolNamesUsed.join(",")}`,
	)
	const unresolvedAnaphora = await runAgentTurn(
		domia,
		"Make it brighter",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{ name: `${SLUG}__HassTurnOn`, arguments: { name: "office light" } },
				],
			},
			{ kind: "reply", text: "I couldn't do that." },
		]),
		{},
	)
	checker.check(
		"unresolved anaphora with a guessed device is blocked (rewrite happens upstream)",
		unresolvedAnaphora.toolNamesUsed.length === 0,
		`used=${unresolvedAnaphora.toolNamesUsed.join(",")}`,
	)

	const resolvedAnaphora = await runAgentTurn(
		domia,
		"Make it brighter",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{ name: `${SLUG}__HassTurnOn`, arguments: { name: "office light" } },
				],
			},
			{ kind: "reply", text: "Done." },
		]),
		{ lastActedTarget: "office light" },
	)
	checker.check(
		"anaphora resolved by the last acted device passes the target guard",
		resolvedAnaphora.toolNamesUsed.join(",") === `${SLUG}__HassTurnOn`,
		`used=${resolvedAnaphora.toolNamesUsed.join(",")}`,
	)

	console.log("\na question never executes a write without confirmation")
	clearConfirmationsForDomia(DOMIA_KEY)
	const questionWrite = await runAgentTurn(
		domia,
		"Is the office light on?",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{ name: `${SLUG}__HassTurnOn`, arguments: { name: "office light" } },
				],
			},
		]),
		{},
	)
	checker.check(
		"write chosen for a question is parked for confirmation",
		questionWrite.stopReason === "confirm_required" &&
			questionWrite.toolNamesUsed.length === 0,
		`stop=${questionWrite.stopReason} used=${questionWrite.toolNamesUsed.join(",")}`,
	)
	checker.check(
		"parked confirmation holds the write tool",
		peekPendingConfirmation(scope)?.tool === `${SLUG}__HassTurnOn`,
	)
	clearConfirmationsForDomia(DOMIA_KEY)
	const questionRecovered = await runAgentTurn(
		domia,
		"Is the office light on?",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{ name: `${SLUG}__HassTurnOn`, arguments: { name: "office light" } },
				],
			},
			{
				kind: "tool_calls",
				calls: [{ name: `${SLUG}__GetLiveContext`, arguments: {} }],
			},
			{ kind: "reply", text: "The office light is on." },
		]),
		{},
	)
	checker.check(
		"write chosen for a question is retried read-only and answered",
		questionRecovered.stopReason === "completed" &&
			questionRecovered.toolNamesUsed.join(",") === `${SLUG}__GetLiveContext` &&
			questionRecovered.reply === "The office light is on." &&
			peekPendingConfirmation(scope) === null,
		`stop=${questionRecovered.stopReason} used=${questionRecovered.toolNamesUsed.join(",")} reply="${questionRecovered.reply}"`,
	)
	checker.check(
		"a read on a question answers without a re-call round",
		questionRecovered.steps === 3,
		`steps=${questionRecovered.steps}`,
	)
	await checkReadBeforeAnswer()
	await checkRetryCue()
	clearConfirmationsForDomia(DOMIA_KEY)
	const commandWrite = await runAgentTurn(
		domia,
		"Turn on the office light",
		TOOLS_CACHE,
		scripted([
			{
				kind: "tool_calls",
				calls: [
					{ name: `${SLUG}__HassTurnOn`, arguments: { name: "office light" } },
				],
			},
			{ kind: "reply", text: "Done." },
		]),
		{},
	)
	checker.check(
		"the same write runs directly for an imperative",
		commandWrite.toolNamesUsed.includes(`${SLUG}__HassTurnOn`) &&
			peekPendingConfirmation(scope) === null,
		`used=${commandWrite.toolNamesUsed.join(",")} stop=${commandWrite.stopReason}`,
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

	await checkStepOutcomes()

	clearConfirmationsForDomia(DOMIA_KEY)
	await disconnectProviders([cfg.id])
	console.log("\na disconnected provider does not advertise its cached tools")
	const deadCfg = {
		...providerCfg("http://127.0.0.1:9/mcp"),
		id: randomUUID(),
		name: "dead",
	}
	const deadConnected = await connectProvider(deadCfg, "dead", "en")
	const withheld = await listTools({
		...domia,
		skillProviders: [deadCfg],
	})
	checker.check(
		"unreachable provider connects false and its cache is withheld",
		!deadConnected && withheld.length === 0,
		`connected=${String(deadConnected)} tools=${withheld.length}`,
	)
	const staleOk = await listTools({
		...domia,
		skillProviders: [
			{
				...deadCfg,
				id: randomUUID(),
				descriptor: {
					version: 1,
					execution: { resilience: { serveStaleTools: true } },
				},
			},
		],
	} as unknown as DomiaType)
	const statuses = providerStatuses({
		...domia,
		skillProviders: [deadCfg, cfg],
	})
	checker.check(
		"provider statuses expose connected vs disconnected with cache counts",
		statuses.length === 2 &&
			!statuses[0]?.connected &&
			statuses[0]?.cachedTools === TOOLS_CACHE.length &&
			statuses[0]?.allowedTools === 0,
		JSON.stringify(statuses.map((s) => [s.name, s.connected, s.cachedTools])),
	)
	checker.check(
		"serveStaleTools opts a provider into serving its cache while down",
		staleOk.length === TOOLS_CACHE.length,
		`tools=${staleOk.length}`,
	)

	await checkAbort()
	await checkToolAliases()
	await checkTargetlessWrites()
	await checkGrammarRejection()
	await checkTwoProviders()

	await mock.close()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} agent-loop checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()

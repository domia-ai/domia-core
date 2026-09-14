import { createServer, type Server as HttpServerType } from "http"
import { randomUUID } from "crypto"

import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/client"
import { Server } from "@modelcontextprotocol/server"
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node"
import { McpServer as McpServerV1 } from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { z } from "zod"

import {
	MCP_PROTOCOL_MODE_ENUM,
	MCP_TRANSPORT_ENUM,
	SKILL_PROTOCOL_ENUM,
	DEFAULT_MCP_INPUT_REQUIRED_MAX_ROUNDS,
} from "@/db"
import type { McpProtocolModeType, SelectSkillProviderType } from "@/db"
import {
	resolveSkillAdapter,
	resolveProtocolMode,
	toolsFreshUntil,
} from "@/modules/skill-engine"
import type {
	SkillConnHandleType,
	SkillElicitResultType,
} from "@/modules/skill-engine"
import { renderContent } from "@/modules/skill-engine/adapters/shared"
import { mcpV2ClientOptions } from "@/modules/skill-engine/adapters/mcp-v2"
import { getSkillProvider } from "@/test-utils"

import { makeChecker, startDualEraMcp } from "./lib"

const checker = makeChecker()

const fixtureTool = (
	name: string,
	description: string,
	properties: Record<string, { type: string }> = {},
) => ({
	name,
	description,
	inputSchema: { type: "object" as const, properties },
})

const PAGE_ONE = [
	fixtureTool("echo_text", "Echoes a phrase back.", {
		phrase: { type: "string" },
	}),
	fixtureTool("structured_report", "Returns only structured content."),
	fixtureTool("mixed_content", "Returns a text part plus an image part."),
	fixtureTool("ask_name", "Elicits a name from the user."),
]

const PAGE_TWO = [
	fixtureTool("slow_progress", "Emits a progress notification then finishes."),
	fixtureTool(
		"trigger_list_changed",
		"Asks the server to announce a tool list change.",
	),
]

const textResult = (text: string) => ({
	content: [{ type: "text" as const, text }],
})

const buildFixtureServer = (): Server => {
	const server = new Server(
		{ name: "eval-mcp-fixture", version: "1.0.0" },
		{ capabilities: { tools: { listChanged: true }, logging: {} } },
	)
	server.setRequestHandler("tools/list", (req) =>
		req.params?.cursor === "page-two"
			? { tools: PAGE_TWO }
			: { tools: PAGE_ONE, nextCursor: "page-two" },
	)
	server.setRequestHandler("tools/call", async (req, ctx) => {
		const name = req.params.name
		if (name === "echo_text") {
			const phrase = req.params.arguments?.phrase
			return textResult(`echo: ${typeof phrase === "string" ? phrase : ""}`)
		}
		if (name === "structured_report")
			return {
				content: [],
				structuredContent: { room: "Kitchen", temperature_c: 21 },
			}
		if (name === "mixed_content")
			return {
				content: [
					{ type: "text" as const, text: "Chart ready." },
					{
						type: "image" as const,
						data: "aGVsbG8=",
						mimeType: "image/png",
					},
				],
			}
		if (name === "ask_name") {
			const answer = await server.request({
				method: "elicitation/create",
				params: {
					message: "What should I call you?",
					requestedSchema: {
						type: "object" as const,
						properties: { name: { type: "string" as const } },
						required: ["name"],
					},
				},
			})
			return textResult(
				`elicited:${answer.action}:${String(answer.content?.name ?? "")}`,
			)
		}
		if (name === "slow_progress") {
			const token = ctx.mcpReq._meta?.progressToken
			if (token !== undefined)
				await server.notification(
					{
						method: "notifications/progress",
						params: { progressToken: token, progress: 1, message: "halfway" },
					},
					{ relatedRequestId: ctx.mcpReq.id },
				)
			return textResult("progress done")
		}
		if (name === "trigger_list_changed") {
			await server.sendToolListChanged()
			return textResult("announced")
		}
		return { content: [], isError: true }
	})
	return server
}

const startFixture = async (): Promise<{
	url: string
	close: () => Promise<void>
}> => {
	const server = buildFixtureServer()
	const transport = new NodeStreamableHTTPServerTransport({
		sessionIdGenerator: () => randomUUID(),
	})
	await server.connect(transport)
	const http: HttpServerType = createServer((req, res) => {
		void transport.handleRequest(req, res).catch(() => {
			if (!res.headersSent) res.writeHead(500).end()
		})
	})
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
	const address = http.address()
	const port = typeof address === "object" && address ? address.port : 0
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		close: async () => {
			await transport.close()
			await server.close()
			await new Promise<void>((resolve) => {
				http.close(() => resolve())
				http.closeAllConnections()
			})
		},
	}
}

const startSseFixture = async (): Promise<{
	url: string
	close: () => Promise<void>
}> => {
	const mcp = new McpServerV1({ name: "eval-sse-fixture", version: "1.0.0" })
	mcp.registerTool(
		"legacy_echo",
		{
			description: "Echoes a phrase back over the legacy SSE transport.",
			inputSchema: { phrase: z.string() },
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		(args) => ({
			content: [{ type: "text" as const, text: `legacy: ${args.phrase}` }],
		}),
	)
	const transports = new Map<string, SSEServerTransport>()
	const http: HttpServerType = createServer((req, res) => {
		void (async () => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1")
			if (req.method === "GET" && url.pathname === "/sse") {
				const transport = new SSEServerTransport("/messages", res)
				transports.set(transport.sessionId, transport)
				res.on("close", () => transports.delete(transport.sessionId))
				await mcp.connect(transport)
				return
			}
			const sessionId = url.searchParams.get("sessionId") ?? ""
			const transport = transports.get(sessionId)
			if (!transport) {
				res.writeHead(404).end()
				return
			}
			await transport.handlePostMessage(req, res)
		})().catch(() => {
			if (!res.headersSent) res.writeHead(500).end()
		})
	})
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
	const address = http.address()
	const port = typeof address === "object" && address ? address.port : 0
	return {
		url: `http://127.0.0.1:${port}/sse`,
		close: async () => {
			await mcp.close()
			await new Promise<void>((resolve) => {
				http.close(() => resolve())
				http.closeAllConnections()
			})
		},
	}
}

const fixtureProvider = (url: string): SelectSkillProviderType =>
	getSkillProvider({
		name: "eval-mcp-fixture",
		protocol: SKILL_PROTOCOL_ENUM.MCP,
		type: MCP_TRANSPORT_ENUM.HTTP,
		url,
		timeout: 5000,
	})

const runAdapterSelectionChecks = (): void => {
	const sse = resolveSkillAdapter(
		SKILL_PROTOCOL_ENUM.MCP,
		MCP_TRANSPORT_ENUM.SSE,
	)
	const http = resolveSkillAdapter(
		SKILL_PROTOCOL_ENUM.MCP,
		MCP_TRANSPORT_ENUM.HTTP,
	)
	const stdio = resolveSkillAdapter(
		SKILL_PROTOCOL_ENUM.MCP,
		MCP_TRANSPORT_ENUM.STDIO,
	)
	checker.check(
		"sse providers select the v1 adapter",
		sse !== null && sse.transports.length === 1 && sse.transports[0] === "sse",
		JSON.stringify(sse?.transports),
	)
	checker.check(
		"http providers select the v2 adapter",
		http?.transports.includes("http") === true,
		JSON.stringify(http?.transports),
	)
	checker.check(
		"stdio providers select the v2 adapter",
		stdio !== null && stdio === http,
		JSON.stringify(stdio?.transports),
	)
	checker.check(
		"http and sse never share an adapter object",
		http !== sse,
		"adapters must not share SDK objects across v1/v2",
	)
	checker.check(
		"an unknown protocol resolves to no adapter",
		resolveSkillAdapter("wyoming", MCP_TRANSPORT_ENUM.HTTP) === null,
	)
	checker.check(
		"omitting the transport still resolves the protocol",
		resolveSkillAdapter(SKILL_PROTOCOL_ENUM.MCP) !== null,
	)
}

const runRenderChecks = (): void => {
	const binary = renderContent(
		[
			{ type: "text", text: "Chart ready." },
			{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
			{ type: "audio", data: "aGVsbG8=", mimeType: "audio/wav" },
		],
		undefined,
		{ provider: "fixture", tool: "mixed_content" },
	)
	checker.check(
		"binary parts are dropped from rendered text",
		binary.text === "Chart ready.",
		binary.text,
	)
	checker.check(
		"dropped binary parts are counted once per call",
		binary.droppedParts === 2,
		String(binary.droppedParts),
	)
	const structured = renderContent(
		[],
		{ room: "Kitchen", temperature_c: 21 },
		{
			provider: "fixture",
			tool: "structured_report",
		},
	)
	checker.check(
		"structuredContent becomes a speakable summary",
		structured.speakableText === "room: Kitchen, temperature c: 21",
		String(structured.speakableText),
	)
	checker.check(
		"structuredContent also fills the model-facing text",
		structured.text === "room: Kitchen, temperature c: 21",
		structured.text,
	)
	const audienceSplit = renderContent(
		[
			{
				type: "text",
				text: "raw rows",
				annotations: { audience: ["assistant"] },
			},
			{
				type: "text",
				text: "It is warm.",
				annotations: { audience: ["user"] },
			},
		],
		undefined,
		{ provider: "fixture", tool: "echo_text" },
	)
	checker.check(
		"audience annotations still split model and user text",
		audienceSplit.text === "raw rows" &&
			audienceSplit.speakableText === "It is warm.",
		JSON.stringify(audienceSplit),
	)
}

const runTransportChecks = async (
	handle: SkillConnHandleType,
	state: { listChanged: number; progress: string[] },
): Promise<void> => {
	const listed = await handle.listTools()
	checker.check(
		"streamable http transport connects and lists tools",
		listed.tools.length > 0,
		String(listed.tools.length),
	)
	checker.check(
		"pagination aggregates across two pages",
		listed.tools.length === PAGE_ONE.length + PAGE_TWO.length,
		listed.tools.map((t) => t.name).join(","),
	)
	checker.check(
		"tools from the second page are present",
		listed.tools.some((t) => t.name === "slow_progress"),
	)
	checker.check(
		"tool descriptions and input schemas survive the walk",
		listed.tools.every((t) => typeof t.description === "string") &&
			listed.tools.every((t) => t.inputSchema !== undefined),
	)

	const echo = await handle.callTool("echo_text", { phrase: "hola" })
	checker.check(
		"callTool returns text content",
		echo.text === "echo: hola" && echo.status === "ok",
		echo.text,
	)

	const structured = await handle.callTool("structured_report", {})
	checker.check(
		"structuredContent travels on the result",
		typeof structured.structured === "object" && structured.structured !== null,
		JSON.stringify(structured.structured),
	)
	checker.check(
		"a structured-only result is still speakable",
		structured.speakableText === "room: Kitchen, temperature c: 21",
		String(structured.speakableText),
	)

	const mixed = await handle.callTool("mixed_content", {})
	checker.check(
		"binary parts are dropped end to end",
		mixed.text === "Chart ready.",
		mixed.text,
	)

	const elicited = await handle.callTool("ask_name", {})
	checker.check(
		"elicitation round trip returns the validated hook result",
		elicited.text === "elicited:accept:Coco",
		elicited.text,
	)

	const progressed = await handle.callTool("slow_progress", {}, undefined, {
		onProgress: (message) => state.progress.push(message ?? ""),
	})
	checker.check(
		"progress notifications reach the caller",
		state.progress.includes("halfway"),
		JSON.stringify(state.progress),
	)
	checker.check(
		"the call still resolves after progress",
		progressed.text === "progress done",
		progressed.text,
	)

	await handle.callTool("trigger_list_changed", {})
	for (let i = 0; i < 40 && state.listChanged === 0; i++)
		await new Promise((resolve) => setTimeout(resolve, 50))
	checker.check(
		"tools/list_changed notifications invalidate the catalog",
		state.listChanged > 0,
		String(state.listChanged),
	)
}

const runElicitationValidationChecks = async (url: string): Promise<void> => {
	const adapter = resolveSkillAdapter(
		SKILL_PROTOCOL_ENUM.MCP,
		MCP_TRANSPORT_ENUM.HTTP,
	)
	if (!adapter) return
	const handle = await adapter.connect(fixtureProvider(url), {
		onElicit: () =>
			Promise.resolve({
				action: "accept",
				content: { name: { nested: "not a scalar" } },
			} as unknown as SkillElicitResultType),
	})
	try {
		const res = await handle.callTool("ask_name", {})
		checker.check(
			"an invalid hook result is rejected and declined",
			res.text === "elicited:decline:",
			res.text,
		)
	} finally {
		await handle.close()
	}
}

const runSseAdapterChecks = async (): Promise<void> => {
	const adapter = resolveSkillAdapter(
		SKILL_PROTOCOL_ENUM.MCP,
		MCP_TRANSPORT_ENUM.SSE,
	)
	if (!adapter) {
		checker.check("the v1 sse adapter is registered", false)
		return
	}
	const fixture = await startSseFixture()
	const handle = await adapter.connect({
		...fixtureProvider(fixture.url),
		type: MCP_TRANSPORT_ENUM.SSE,
		url: fixture.url,
	})
	try {
		const listed = await handle.listTools()
		checker.check(
			"the v1 sse adapter connects and lists tools",
			listed.tools.some((t) => t.name === "legacy_echo"),
			listed.tools.map((t) => t.name).join(","),
		)
		const res = await handle.callTool("legacy_echo", { phrase: "adios" })
		checker.check(
			"the v1 sse adapter calls tools",
			res.text === "legacy: adios" && res.status === "ok",
			res.text,
		)
	} finally {
		await handle.close()
		await fixture.close()
	}
}

const modeProvider = (
	url: string,
	protocolMode: McpProtocolModeType,
	timeout = 5000,
): SelectSkillProviderType =>
	getSkillProvider({
		name: `eval-mcp-${protocolMode}`,
		protocol: SKILL_PROTOCOL_ENUM.MCP,
		type: MCP_TRANSPORT_ENUM.HTTP,
		url,
		timeout,
		config: { protocolMode },
	})

const waitFor = async (cond: () => boolean, attempts = 60): Promise<void> => {
	for (let i = 0; i < attempts && !cond(); i++)
		await new Promise((resolve) => setTimeout(resolve, 50))
}

const runProtocolModeChecks = (): void => {
	const unset = fixtureProvider("http://127.0.0.1:1/mcp")
	checker.check(
		"a provider without config defaults to the legacy protocol mode",
		resolveProtocolMode(unset) === MCP_PROTOCOL_MODE_ENUM.LEGACY,
		resolveProtocolMode(unset),
	)
	checker.check(
		"an unknown protocolMode falls back to legacy",
		resolveProtocolMode({
			...unset,
			config: { protocolMode: "3000-01-01" as McpProtocolModeType },
		}) === MCP_PROTOCOL_MODE_ENUM.LEGACY,
	)
	const legacy = mcpV2ClientOptions(unset, {
		onToolListChanged: () => undefined,
	})
	checker.check(
		"legacy providers send today's client options untouched",
		JSON.stringify(Object.keys(legacy).sort()) ===
			JSON.stringify(["capabilities", "listMaxPages"]),
		JSON.stringify(Object.keys(legacy)),
	)
	const auto = mcpV2ClientOptions(
		modeProvider("http://127.0.0.1:1/mcp", MCP_PROTOCOL_MODE_ENUM.AUTO),
		{ onToolListChanged: () => undefined },
	)
	checker.check(
		"auto maps to versionNegotiation mode auto",
		JSON.stringify(auto.versionNegotiation) === '{"mode":"auto"}',
		JSON.stringify(auto.versionNegotiation),
	)
	checker.check(
		"modern modes open a listChanged subscription instead of a raw handler",
		auto.listChanged?.tools?.autoRefresh === false &&
			auto.listChanged.tools.debounceMs === 0,
		JSON.stringify(auto.listChanged?.tools?.autoRefresh),
	)
	const pinned = mcpV2ClientOptions(
		modeProvider("http://127.0.0.1:1/mcp", MCP_PROTOCOL_MODE_ENUM.MODERN),
	)
	checker.check(
		"2026-07-28 pins the modern revision",
		JSON.stringify(pinned.versionNegotiation) ===
			'{"mode":{"pin":"2026-07-28"}}',
		JSON.stringify(pinned.versionNegotiation),
	)
	checker.check(
		"modern modes enable MRTR auto-fulfilment",
		pinned.inputRequired?.autoFulfill === true &&
			pinned.inputRequired.maxRounds === DEFAULT_MCP_INPUT_REQUIRED_MAX_ROUNDS,
		JSON.stringify(pinned.inputRequired),
	)
}

const runCacheHintChecks = (): void => {
	const now = Date.now()
	const hinted = toolsFreshUntil(300_000, 1_000)
	checker.check(
		"a server ttl lowers the configured refresh window",
		hinted !== null && hinted - now <= 1_100,
		String((hinted ?? 0) - now),
	)
	const unhinted = toolsFreshUntil(300_000)
	checker.check(
		"no server ttl keeps the configured refresh window",
		unhinted !== null && unhinted - now > 200_000,
		String((unhinted ?? 0) - now),
	)
	const longer = toolsFreshUntil(1_000, 999_999)
	checker.check(
		"a longer server ttl never extends the configured refresh",
		longer !== null && longer - now <= 1_100,
		String((longer ?? 0) - now),
	)
	checker.check(
		"ttlMs 0 marks the catalog immediately stale",
		toolsFreshUntil(300_000, 0) === null,
	)
	checker.check(
		"a disabled refresh stays disabled whatever the server hints",
		toolsFreshUntil(0, 60_000) === null,
	)
}

const runHeaderMismatchCheck = async (url: string): Promise<void> => {
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"MCP-Protocol-Version": MCP_PROTOCOL_MODE_ENUM.MODERN,
			"Mcp-Method": "tools/list",
			"Mcp-Name": "EraProbe",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "EraProbe",
				arguments: {},
				_meta: {
					[PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_MODE_ENUM.MODERN,
					[CLIENT_INFO_META_KEY]: { name: "eval-headers", version: "1.0.0" },
					[CLIENT_CAPABILITIES_META_KEY]: {},
				},
			},
		}),
	})
	const body = (await res.json()) as { error?: { code?: number } }
	checker.check(
		"a mismatched Mcp-Method header is rejected as a protocol error",
		body.error?.code === -32020,
		`${res.status}:${JSON.stringify(body.error ?? body)}`,
	)
}

const runDualEraChecks = async (): Promise<void> => {
	const adapter = resolveSkillAdapter(
		SKILL_PROTOCOL_ENUM.MCP,
		MCP_TRANSPORT_ENUM.HTTP,
	)
	if (!adapter) {
		checker.check("the v2 adapter is registered for http", false)
		return
	}
	const mock = await startDualEraMcp()
	const state = { listChanged: 0 }
	const modern = await adapter.connect(
		modeProvider(mock.url, MCP_PROTOCOL_MODE_ENUM.AUTO),
		{
			onToolListChanged: () => {
				state.listChanged++
			},
			onElicit: () =>
				Promise.resolve({ action: "accept", content: { confirm: true } }),
		},
	)
	try {
		checker.check(
			"auto negotiates the modern era against a 2026-07-28 server",
			modern.protocolEra?.() === "modern",
			String(modern.protocolEra?.()),
		)
		const listed = await modern.listTools()
		checker.check(
			"a modern tools/list carries the standard ttl hint",
			listed.ttlMs === mock.ttlMs,
			String(listed.ttlMs),
		)
		const deployed = await modern.callTool("ConfirmDeploy", { env: "prod" })
		checker.check(
			"an input_required round trip completes through the presenter",
			deployed.text === "deployed:prod" && deployed.status === "ok",
			`${deployed.status}:${deployed.text}`,
		)
		await modern.callTool("TriggerToolsChanged", {})
		await waitFor(() => state.listChanged > 0)
		checker.check(
			"listChanged subscriptions deliver tool changes in the modern era",
			state.listChanged > 0,
			String(state.listChanged),
		)
	} finally {
		await modern.close()
	}

	const legacy = await adapter.connect(
		modeProvider(mock.url, MCP_PROTOCOL_MODE_ENUM.LEGACY),
	)
	try {
		checker.check(
			"legacy providers stay on the 2025 era against the same server",
			(legacy.protocolEra?.() ?? "legacy") === "legacy",
			String(legacy.protocolEra?.()),
		)
		const listed = await legacy.listTools()
		checker.check(
			"a legacy tools/list carries no cache hint",
			listed.ttlMs === undefined,
			String(listed.ttlMs),
		)
	} finally {
		await legacy.close()
	}

	const stalled = await adapter.connect(
		modeProvider(mock.url, MCP_PROTOCOL_MODE_ENUM.AUTO, 600),
		{ onElicit: () => new Promise<SkillElicitResultType>(() => undefined) },
	)
	try {
		const res = await stalled.callTool(
			"ConfirmDeploy",
			{ env: "prod" },
			undefined,
			{ timeoutMs: 10_000 },
		)
		checker.check(
			"an unanswered input_required fails cleanly instead of hanging",
			res.isError && res.status === "error",
			`${res.status}:${res.text}`,
		)
		const probe = await stalled.callTool("EraProbe", {})
		checker.check(
			"the connection survives an unanswered input_required",
			probe.text === "probe ok" && probe.status === "ok",
			probe.text,
		)
	} finally {
		await stalled.close()
	}

	await runHeaderMismatchCheck(mock.url)
	await mock.close()
}

const runEraFallbackCheck = async (): Promise<void> => {
	const adapter = resolveSkillAdapter(
		SKILL_PROTOCOL_ENUM.MCP,
		MCP_TRANSPORT_ENUM.HTTP,
	)
	if (!adapter) return
	const fixture = await startFixture()
	const handle = await adapter.connect(
		modeProvider(fixture.url, MCP_PROTOCOL_MODE_ENUM.AUTO),
	)
	try {
		checker.check(
			"auto falls back to the legacy era against a 2025-only server",
			handle.protocolEra?.() === "legacy",
			String(handle.protocolEra?.()),
		)
		const listed = await handle.listTools()
		checker.check(
			"the legacy fallback still lists tools",
			listed.tools.length > 0,
			String(listed.tools.length),
		)
	} finally {
		await handle.close()
		await fixture.close()
	}
}

const main = async (): Promise<void> => {
	runAdapterSelectionChecks()
	runRenderChecks()
	const fixture = await startFixture()
	const state = { listChanged: 0, progress: [] as string[] }
	const adapter = resolveSkillAdapter(
		SKILL_PROTOCOL_ENUM.MCP,
		MCP_TRANSPORT_ENUM.HTTP,
	)
	if (!adapter) throw new Error("no v2 adapter registered for http")
	const handle = await adapter.connect(fixtureProvider(fixture.url), {
		onToolListChanged: () => {
			state.listChanged++
		},
		onElicit: () =>
			Promise.resolve({ action: "accept", content: { name: "Coco" } }),
	})
	try {
		await runTransportChecks(handle, state)
	} finally {
		await handle.close()
	}
	const second = await startFixture()
	await runElicitationValidationChecks(second.url)
	await second.close()
	await fixture.close()
	await runSseAdapterChecks()
	runProtocolModeChecks()
	runCacheHintChecks()
	await runEraFallbackCheck()
	await runDualEraChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} mcp-client checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()

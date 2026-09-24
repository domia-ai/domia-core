import { createServer } from "http"
import {
	NodeStreamableHTTPServerTransport,
	toNodeHandler,
} from "@modelcontextprotocol/node"
import {
	McpServer,
	createMcpHandler,
	inputRequired,
	inputResponse,
	acceptedContent,
} from "@modelcontextprotocol/server"
import { z } from "zod"
import { createBehaviorGate, withPoison } from "./mock-behavior"
import type {
	MockHaServerType,
	MockHaBehaviorType,
	MockBehaviorGateType,
	MockMcpServerType,
	MockDualEraServerType,
	MockEntityStateType,
	MockHaEntityType,
	MockHaSiteType,
	HaMcpToolSpecType,
} from "../types"

const DEFAULT_ENTITIES: MockHaEntityType[] = [
	{
		names: ["Kitchen Light", "Luz de la Cocina"],
		domain: "light",
		area: "Kitchen",
	},
	{
		names: ["Bedroom Light", "Luz del Dormitorio"],
		domain: "light",
		area: "Bedroom",
	},
	{
		names: ["Living Room Light", "Luz de la Sala"],
		domain: "light",
		area: "Living Room",
	},
	{
		names: ["Office Lights", "Luz de la Oficina"],
		domain: "light",
		area: "Office",
	},
	{
		names: ["Exterior Sconces"],
		domain: "light",
		area: "Exterior",
	},
	{
		names: ["BeyondTV"],
		domain: "media_player",
		area: "Living Room",
	},
	{
		names: ["Front Door"],
		domain: "lock",
		area: "Entryway",
	},
]

export const mockEntityNames = (): string[] =>
	DEFAULT_ENTITIES.flatMap((e) => e.names)

const defaultBehavior = (): MockHaBehaviorType => ({
	latencyMs: {},
	fail: {},
	poison: {},
	annotations: false,
	catalogSize: 0,
	domainPrefixed: false,
})

const TOOL_DOMAINS: Record<string, string> = {
	GetLiveContext: "homeassistant",
	GetDateTime: "llm",
	HassTurnOn: "intent",
	HassTurnOff: "intent",
	HassLightSet: "light",
	HassLockDoor: "lock",
}

const HAND_REGISTERED_TOOLS = new Set([
	"GetLiveContext",
	"HassTurnOn",
	"HassTurnOff",
	"HassLightSet",
	"HassLockDoor",
])

const toolDomainsOf = (
	tools: HaMcpToolSpecType[] | undefined,
): Record<string, string> => ({
	...TOOL_DOMAINS,
	...Object.fromEntries((tools ?? []).map((t) => [t.rawName, t.domain])),
})

const advertisedName = (
	behavior: MockHaBehaviorType,
	tool: string,
	domains: Record<string, string>,
): string => {
	if (!behavior.domainPrefixed) return tool
	const prefix = domains[tool] ?? "intent"
	return `${prefix}__${tool}`
}

const createEntityStates = (
	entities: MockHaEntityType[],
): MockEntityStateType[] =>
	entities.map(() => ({ on: false, brightness: null }))

const matchesTarget = (
	entity: MockHaEntityType,
	args: { name?: string; area?: string; domain?: string[] },
): boolean => {
	const name = args.name?.trim().toLowerCase()
	const area = args.area?.trim().toLowerCase()
	const domainOk = !args.domain?.length || args.domain.includes(entity.domain)
	const nameHit =
		name !== undefined &&
		name.length > 0 &&
		(entity.names.some((n) => {
			const folded = n.toLowerCase()
			return folded === name || folded.includes(name) || name.includes(folded)
		}) ||
			entity.area.toLowerCase() === name)
	const areaHit = area !== undefined && entity.area.toLowerCase() === area
	if (name) return nameHit && (area === undefined || areaHit) && domainOk
	if (area !== undefined) return areaHit && domainOk
	return !!args.domain?.length && domainOk
}

const applyWrite = (
	entities: MockHaEntityType[],
	states: MockEntityStateType[],
	args: { name?: string; area?: string; domain?: string[] },
	patch: Partial<MockEntityStateType>,
): void => {
	entities.forEach((entity, i) => {
		if (matchesTarget(entity, args)) Object.assign(states[i], patch)
	})
}

const liveContext = (
	entities: MockHaEntityType[],
	gate: MockBehaviorGateType,
	states: MockEntityStateType[],
): string => {
	const rows = entities.map((e, i) => {
		const state = states[i]
		const brightness =
			state.on && state.brightness !== null
				? `\n  brightness: ${state.brightness}`
				: ""
		const area = e.area ? `\n  areas: ${e.area}` : ""
		return `- names: ${e.names.join(", ")}\n  domain: ${e.domain}${area}\n  state: ${state.on ? "on" : "off"}${brightness}`
	})
	const poison = gate.poisonOf("GetLiveContext")
	if (poison)
		rows.push(`- names: ${poison}\n  domain: light\n  areas: Living Room`)
	return rows.join("\n")
}

const targetArgs = z.object({
	name: z.string().optional(),
	area: z.string().optional(),
	floor: z.string().optional(),
	domain: z.array(z.string()).optional(),
	device_class: z.array(z.string()).optional(),
})

const text = (t: string): { content: { type: "text"; text: string }[] } => ({
	content: [{ type: "text" as const, text: t }],
})

const errText = (
	t: string,
): { content: { type: "text"; text: string }[]; isError: true } => ({
	content: [{ type: "text" as const, text: t }],
	isError: true,
})

const gated = async (
	gate: MockBehaviorGateType,
	tool: string,
	ok: () => string,
): Promise<
	{ content: { type: "text"; text: string }[] } & { isError?: boolean }
> => {
	const err = await gate.check(tool)
	return err ? errText(err) : text(ok())
}

const SYNTHETIC_VERBS = [
	"Toggle",
	"Adjust",
	"Query",
	"Schedule",
	"Calibrate",
	"Monitor",
	"Sync",
	"Reset",
]
const SYNTHETIC_NOUNS = [
	"Tv",
	"Heating",
	"Blinds",
	"Sprinkler",
	"Camera",
	"Doorbell",
	"Vacuum",
	"Speaker",
	"Thermostat",
	"Humidifier",
	"Fan",
	"Purifier",
	"Kettle",
	"Oven",
	"Washer",
	"Dryer",
	"Charger",
	"Gate",
	"Awning",
	"Pump",
	"Sensor",
	"Valve",
	"Lock2",
	"Scene",
	"Script",
]

const syntheticNames = (count: number): string[] => {
	const out: string[] = []
	for (let i = 0; out.length < count; i++) {
		const verb = SYNTHETIC_VERBS[i % SYNTHETIC_VERBS.length]
		const noun =
			SYNTHETIC_NOUNS[
				Math.floor(i / SYNTHETIC_VERBS.length) % SYNTHETIC_NOUNS.length
			]
		const suffix = Math.floor(
			i / (SYNTHETIC_VERBS.length * SYNTHETIC_NOUNS.length),
		)
		out.push(`Hass${verb}${noun}${suffix > 0 ? suffix : ""}`)
	}
	return out
}

const withAnnotations = (
	behavior: MockHaBehaviorType,
	annotations: Record<string, unknown>,
): { annotations?: Record<string, unknown> } =>
	behavior.annotations ? { annotations } : {}

const siteToolSchema = (
	spec: HaMcpToolSpecType,
): z.ZodObject<Record<string, z.ZodType>> =>
	z.object(
		Object.fromEntries(
			Object.entries(spec.properties).map(([key, prop]) => [
				key,
				prop.type === "string"
					? z.string().optional()
					: prop.type === "number"
						? z.number().optional()
						: z.array(z.string()).optional(),
			]),
		),
	)

const buildMcpServer = (
	behavior: MockHaBehaviorType,
	states: MockEntityStateType[],
	gate: MockBehaviorGateType,
	entities: MockHaEntityType[],
	site?: MockHaSiteType,
): McpServer => {
	const domains = toolDomainsOf(site?.tools)
	const named = (tool: string): string =>
		advertisedName(behavior, tool, domains)
	const mcp = new McpServer({ name: "eval-mock-ha", version: "1.0.0" })
	mcp.registerTool(
		named("GetLiveContext"),
		{
			description:
				"Provides real-time information about the CURRENT state, value, or mode of devices, sensors, entities, or areas.",
			inputSchema: z.object({}),
			...withAnnotations(behavior, {
				readOnlyHint: true,
				openWorldHint: false,
			}),
		},
		async () =>
			gated(gate, "GetLiveContext", () => liveContext(entities, gate, states)),
	)
	mcp.registerTool(
		named("HassTurnOn"),
		{
			description:
				"Turns on/opens/presses a device or entity. Use for requests like 'turn on', 'activate', 'enable'.",
			inputSchema: targetArgs,
			...withAnnotations(behavior, {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			}),
		},
		async (args) =>
			gated(gate, "HassTurnOn", () => {
				applyWrite(entities, states, args, { on: true })
				return withPoison(
					gate,
					"HassTurnOn",
					`Turned on ${args.name ?? args.area ?? "device"}`,
				)
			}),
	)
	mcp.registerTool(
		named("HassTurnOff"),
		{
			description:
				"Turns off/closes a device or entity. Use for requests like 'turn off', 'deactivate', 'disable'.",
			inputSchema: targetArgs,
			...withAnnotations(behavior, {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			}),
		},
		async (args) =>
			gated(gate, "HassTurnOff", () => {
				applyWrite(entities, states, args, { on: false })
				return withPoison(
					gate,
					"HassTurnOff",
					`Turned off ${args.name ?? args.area ?? "device"}`,
				)
			}),
	)
	mcp.registerTool(
		named("HassLightSet"),
		{
			description: "Sets the brightness percentage or color of a light",
			inputSchema: targetArgs.extend({
				color: z.string().optional(),
				temperature: z.number().optional(),
				brightness: z.number().optional(),
			}),
			...withAnnotations(behavior, {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			}),
		},
		async (args) =>
			gated(gate, "HassLightSet", () => {
				applyWrite(entities, states, args, {
					on: true,
					...(args.brightness === undefined
						? {}
						: { brightness: args.brightness }),
				})
				return withPoison(
					gate,
					"HassLightSet",
					`Set ${args.name ?? args.area ?? "light"}`,
				)
			}),
	)
	mcp.registerTool(
		named("HassLockDoor"),
		{
			description: "Locks or unlocks a door lock entity.",
			inputSchema: targetArgs,
		},
		async (args) =>
			gated(gate, "HassLockDoor", () => `Locked ${args.name ?? "door"}`),
	)
	for (const name of syntheticNames(behavior.catalogSize)) {
		mcp.registerTool(
			named(name),
			{
				description: `Controls the ${name.replace(/^Hass/, "").toLowerCase()} accessory in the home.`,
				inputSchema: targetArgs,
			},
			async (args) =>
				gated(gate, name, () => `${name} done for ${args.name ?? "target"}`),
		)
	}
	for (const spec of site?.tools ?? []) {
		if (HAND_REGISTERED_TOOLS.has(spec.rawName)) continue
		mcp.registerTool(
			named(spec.rawName),
			{ description: spec.description, inputSchema: siteToolSchema(spec) },
			async () => gated(gate, spec.rawName, () => `${spec.rawName} done`),
		)
	}
	return mcp
}

export const startMockHa = async (
	port = 0,
	baseBehavior: Partial<MockHaBehaviorType> = {},
	site?: MockHaSiteType,
): Promise<MockHaServerType> => {
	const entities = site?.entities ?? DEFAULT_ENTITIES
	const states = createEntityStates(entities)
	let behavior = { ...defaultBehavior(), ...baseBehavior }
	const gate = createBehaviorGate(() => behavior)
	const server = createServer((req, res) => {
		if (req.url === "/__control" && req.method === "POST") {
			let body = ""
			req.on("data", (c: Buffer) => (body += c.toString()))
			req.on("end", () => {
				try {
					const patch = JSON.parse(body || "{}") as Partial<MockHaBehaviorType>
					behavior = { ...defaultBehavior(), ...baseBehavior, ...patch }
					gate.resetCounts()
					res.writeHead(200, { "content-type": "application/json" })
					res.end(JSON.stringify(behavior))
				} catch {
					res.writeHead(400).end()
				}
			})
			return
		}
		void (async () => {
			const mcp = buildMcpServer(behavior, states, gate, entities, site)
			const transport = new NodeStreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
			})
			res.on("close", () => {
				void transport.close()
				void mcp.close()
			})
			await mcp.connect(transport)
			await transport.handleRequest(req, res)
		})().catch(() => {
			if (!res.headersSent) res.writeHead(500).end()
		})
	})
	await new Promise<void>((resolve) =>
		server.listen(port, "127.0.0.1", resolve),
	)
	const address = server.address()
	const boundPort = typeof address === "object" && address ? address.port : port
	const base = `http://127.0.0.1:${boundPort}`
	return {
		url: `${base}/mcp`,
		setBehavior: async (patch) => {
			await fetch(`${base}/__control`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch),
			})
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			}),
	}
}

const buildPlainMcpServer = (): McpServer => {
	const mcp = new McpServer({ name: "eval-plain-mcp", version: "1.0.0" })
	mcp.registerTool(
		"NoteRead",
		{
			description: "Reads the text of a note by its title.",
			inputSchema: z.object({ title: z.string() }),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		(args) => text(`Note ${args.title}: buy milk`),
	)
	mcp.registerTool(
		"NoteDelete",
		{
			description: "Permanently deletes a note by its title.",
			inputSchema: z.object({ title: z.string() }),
			annotations: { destructiveHint: true, openWorldHint: false },
		},
		(args) => text(`Deleted note ${args.title}`),
	)
	mcp.registerTool(
		"NotePublish",
		{
			description: "Publishes a note to the public web board.",
			inputSchema: z.object({ title: z.string() }),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		(args) => text(`Published note ${args.title}`),
	)
	return mcp
}

export const startPlainMcp = async (port = 0): Promise<MockMcpServerType> => {
	const server = createServer((req, res) => {
		void (async () => {
			const mcp = buildPlainMcpServer()
			const transport = new NodeStreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
			})
			res.on("close", () => {
				void transport.close()
				void mcp.close()
			})
			await mcp.connect(transport)
			await transport.handleRequest(req, res)
		})().catch(() => {
			if (!res.headersSent) res.writeHead(500).end()
		})
	})
	await new Promise<void>((resolve) =>
		server.listen(port, "127.0.0.1", resolve),
	)
	const address = server.address()
	const boundPort = typeof address === "object" && address ? address.port : port
	return {
		url: `http://127.0.0.1:${boundPort}/mcp`,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			}),
	}
}

const DUAL_ERA_TOOLS_TTL_MS = 900

const buildDualEraServer = (announce: () => void): McpServer => {
	const mcp = new McpServer(
		{ name: "eval-dual-era", version: "1.0.0" },
		{
			capabilities: { tools: { listChanged: true } },
			cacheHints: {
				"tools/list": {
					ttlMs: DUAL_ERA_TOOLS_TTL_MS,
					cacheScope: "public",
				},
			},
		},
	)
	mcp.registerTool(
		"EraProbe",
		{
			description: "Reports that the connection is alive.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		() => text("probe ok"),
	)
	mcp.registerTool(
		"ConfirmDeploy",
		{
			description: "Deploys an environment once the user confirms.",
			inputSchema: z.object({ env: z.string() }),
		},
		(args, ctx) => {
			const answer = inputResponse(ctx.mcpReq.inputResponses, "confirm")
			if (answer.kind === "missing")
				return inputRequired({
					inputRequests: {
						confirm: inputRequired.elicit({
							message: `Deploy to ${args.env}?`,
							requestedSchema: {
								type: "object",
								properties: { confirm: { type: "boolean" } },
								required: ["confirm"],
							},
						}),
					},
					requestState: "awaiting-confirm",
				})
			const accepted = acceptedContent<{ confirm: boolean }>(
				ctx.mcpReq.inputResponses,
				"confirm",
			)
			if (!accepted) return errText("deploy cancelled")
			return accepted.confirm
				? text(`deployed:${args.env}`)
				: errText("deploy declined")
		},
	)
	mcp.registerTool(
		"TriggerToolsChanged",
		{
			description: "Announces a tool list change to open subscriptions.",
			inputSchema: z.object({}),
		},
		() => {
			announce()
			return text("announced")
		},
	)
	return mcp
}

export const startDualEraMcp = async (
	port = 0,
): Promise<MockDualEraServerType> => {
	const handler = createMcpHandler(() =>
		buildDualEraServer(() => handler.notify.toolsChanged()),
	)
	const nodeHandler = toNodeHandler(handler)
	const server = createServer((req, res) => {
		void nodeHandler(req, res)
	})
	await new Promise<void>((resolve) =>
		server.listen(port, "127.0.0.1", resolve),
	)
	const address = server.address()
	const boundPort = typeof address === "object" && address ? address.port : port
	return {
		url: `http://127.0.0.1:${boundPort}/mcp`,
		ttlMs: DUAL_ERA_TOOLS_TTL_MS,
		close: async () => {
			await handler.close()
			await new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			})
		},
	}
}

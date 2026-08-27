import { createServer } from "http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import { sleep } from "./http"
import type { MockHaServerType, MockHaBehaviorType } from "../types"

const ENTITIES = [
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
]

const defaultBehavior = (): MockHaBehaviorType => ({
	latencyMs: {},
	fail: {},
	poison: {},
	annotations: false,
	catalogSize: 0,
})

const liveContext = (behavior: MockHaBehaviorType): string => {
	const rows = ENTITIES.map(
		(e) =>
			`- names: ${e.names.join(", ")}\n  domain: ${e.domain}\n  areas: ${e.area}`,
	)
	const poison = behavior.poison["GetLiveContext"]
	if (poison)
		rows.push(`- names: ${poison}\n  domain: light\n  areas: Living Room`)
	return rows.join("\n")
}

const targetArgs = {
	name: z.string().optional(),
	area: z.string().optional(),
	floor: z.string().optional(),
	domain: z.array(z.string()).optional(),
	device_class: z.array(z.string()).optional(),
}

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
	behavior: MockHaBehaviorType,
	tool: string,
	ok: () => string,
): Promise<
	{ content: { type: "text"; text: string }[] } & { isError?: boolean }
> => {
	const err = await gate(behavior, tool)
	return err ? errText(err) : text(ok())
}

const failCounts = new Map<string, number>()

const gate = async (
	behavior: MockHaBehaviorType,
	tool: string,
): Promise<string | null> => {
	const latency = behavior.latencyMs[tool] ?? behavior.latencyMs["*"]
	if (latency) await sleep(latency)
	const fail = behavior.fail[tool] ?? behavior.fail["*"]
	if (fail === "always") return `Error: ${tool} unavailable`
	if (typeof fail === "number") {
		const used = failCounts.get(tool) ?? 0
		if (used < fail) {
			failCounts.set(tool, used + 1)
			return `Error: ${tool} temporarily failed`
		}
	}
	return null
}

const resultText = (
	behavior: MockHaBehaviorType,
	tool: string,
	base: string,
): string => {
	const poison = behavior.poison[tool]
	return poison ? `${base}. ${poison}` : base
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

const buildMcpServer = (behavior: MockHaBehaviorType): McpServer => {
	const mcp = new McpServer({ name: "eval-mock-ha", version: "1.0.0" })
	mcp.registerTool(
		"GetLiveContext",
		{
			description:
				"Provides real-time information about the CURRENT state, value, or mode of devices, sensors, entities, or areas.",
			inputSchema: {},
			...withAnnotations(behavior, {
				readOnlyHint: true,
				openWorldHint: false,
			}),
		},
		async () => gated(behavior, "GetLiveContext", () => liveContext(behavior)),
	)
	mcp.registerTool(
		"HassTurnOn",
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
			gated(behavior, "HassTurnOn", () =>
				resultText(
					behavior,
					"HassTurnOn",
					`Turned on ${args.name ?? args.area ?? "device"}`,
				),
			),
	)
	mcp.registerTool(
		"HassTurnOff",
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
			gated(behavior, "HassTurnOff", () =>
				resultText(
					behavior,
					"HassTurnOff",
					`Turned off ${args.name ?? args.area ?? "device"}`,
				),
			),
	)
	mcp.registerTool(
		"HassLightSet",
		{
			description: "Sets the brightness percentage or color of a light",
			inputSchema: {
				...targetArgs,
				color: z.string().optional(),
				temperature: z.number().optional(),
				brightness: z.number().optional(),
			},
			...withAnnotations(behavior, {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			}),
		},
		async (args) =>
			gated(behavior, "HassLightSet", () =>
				resultText(
					behavior,
					"HassLightSet",
					`Set ${args.name ?? args.area ?? "light"}`,
				),
			),
	)
	mcp.registerTool(
		"HassLockDoor",
		{
			description: "Locks or unlocks a door lock entity.",
			inputSchema: targetArgs,
		},
		async (args) =>
			gated(behavior, "HassLockDoor", () => `Locked ${args.name ?? "door"}`),
	)
	for (const name of syntheticNames(behavior.catalogSize)) {
		mcp.registerTool(
			name,
			{
				description: `Controls the ${name.replace(/^Hass/, "").toLowerCase()} accessory in the home.`,
				inputSchema: targetArgs,
			},
			async (args) =>
				gated(
					behavior,
					name,
					() => `${name} done for ${args.name ?? "target"}`,
				),
		)
	}
	return mcp
}

export const startMockHa = async (port = 3199): Promise<MockHaServerType> => {
	let behavior = defaultBehavior()
	const server = createServer((req, res) => {
		if (req.url === "/__control" && req.method === "POST") {
			let body = ""
			req.on("data", (c) => (body += c))
			req.on("end", () => {
				try {
					const patch = JSON.parse(body || "{}") as Partial<MockHaBehaviorType>
					behavior = { ...defaultBehavior(), ...patch }
					failCounts.clear()
					res.writeHead(200, { "content-type": "application/json" })
					res.end(JSON.stringify(behavior))
				} catch {
					res.writeHead(400).end()
				}
			})
			return
		}
		void (async () => {
			const mcp = buildMcpServer(behavior)
			const transport = new StreamableHTTPServerTransport({
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

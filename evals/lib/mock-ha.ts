import { createServer } from "http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import type { MockHaServerType } from "../types"

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

const liveContext = (): string =>
	ENTITIES.map(
		(e) =>
			`- names: ${e.names.join(", ")}\n  domain: ${e.domain}\n  areas: ${e.area}`,
	).join("\n")

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

const buildMcpServer = (): McpServer => {
	const mcp = new McpServer({ name: "eval-mock-ha", version: "1.0.0" })
	mcp.registerTool(
		"GetLiveContext",
		{
			description:
				"Provides real-time information about the CURRENT state, value, or mode of devices, sensors, entities, or areas.",
			inputSchema: {},
		},
		async () => text(liveContext()),
	)
	mcp.registerTool(
		"HassTurnOn",
		{
			description:
				"Turns on/opens/presses a device or entity. Use for requests like 'turn on', 'activate', 'enable'.",
			inputSchema: targetArgs,
		},
		async (args) => text(`Turned on ${args.name ?? args.area ?? "device"}`),
	)
	mcp.registerTool(
		"HassTurnOff",
		{
			description:
				"Turns off/closes a device or entity. Use for requests like 'turn off', 'deactivate', 'disable'.",
			inputSchema: targetArgs,
		},
		async (args) => text(`Turned off ${args.name ?? args.area ?? "device"}`),
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
		},
		async (args) => text(`Set ${args.name ?? args.area ?? "light"}`),
	)
	return mcp
}

export const startMockHa = async (port = 3199): Promise<MockHaServerType> => {
	const server = createServer((req, res) => {
		void (async () => {
			const mcp = buildMcpServer()
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
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			}),
	}
}

import { createServer } from "http"
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node"
import { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"

import { SKILL_DESCRIPTOR_RESOURCE_URI } from "@/db"

import type { MockDescriptorMcpServerType } from "../types"

const buildDescriptorMcpServer = (descriptorText: string | null): McpServer => {
	const mcp = new McpServer({ name: "eval-descriptor-mcp", version: "1.0.0" })
	mcp.registerTool(
		"get_forecast",
		{
			description: "Reads the weather forecast for a city.",
			inputSchema: z.object({ city: z.string() }),
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		(args) => ({
			content: [
				{ type: "text" as const, text: `Sunny in ${args.city}, 24 degrees.` },
			],
		}),
	)
	if (descriptorText !== null)
		mcp.registerResource(
			"domia-descriptor",
			SKILL_DESCRIPTOR_RESOURCE_URI,
			{ title: "Domia skill descriptor", mimeType: "application/json" },
			(uri) => ({
				contents: [
					{ uri: uri.href, mimeType: "application/json", text: descriptorText },
				],
			}),
		)
	return mcp
}

export const startMockDescriptorMcp = async (
	initialDescriptor: string | null,
): Promise<MockDescriptorMcpServerType> => {
	const state = { descriptor: initialDescriptor }
	const server = createServer((req, res) => {
		void (async () => {
			const mcp = buildDescriptorMcpServer(state.descriptor)
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
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	const address = server.address()
	if (typeof address !== "object" || !address)
		throw new Error("mock descriptor MCP did not bind a TCP port")
	return {
		url: `http://127.0.0.1:${address.port}/mcp`,
		setDescriptor: (text) => {
			state.descriptor = text
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			}),
	}
}

declare module "@modelcontextprotocol/sdk/client/index.js" {
	export type McpToolDescriptor = {
		name: string
		description?: string
		inputSchema?: Record<string, unknown>
	}
	export type McpContentPart = {
		type: string
		text?: string
	}
	export type McpToolResult = {
		content?: McpContentPart[]
		isError?: boolean
	}
	export class Client {
		constructor(
			info: { name: string; version: string },
			options?: { capabilities?: Record<string, unknown> },
		)
		connect(transport: unknown, options?: { timeout?: number }): Promise<void>
		listTools(): Promise<{ tools: McpToolDescriptor[] }>
		callTool(
			params: { name: string; arguments?: Record<string, unknown> },
			resultSchema?: unknown,
			options?: { timeout?: number },
		): Promise<McpToolResult>
		close(): Promise<void>
	}
}

declare module "@modelcontextprotocol/sdk/client/streamableHttp.js" {
	/* eslint-disable-next-line @typescript-eslint/no-extraneous-class */
	export class StreamableHTTPClientTransport {
		constructor(
			url: URL,
			opts?: { requestInit?: { headers?: Record<string, string> } },
		)
	}
}

declare module "@modelcontextprotocol/sdk/client/sse.js" {
	/* eslint-disable-next-line @typescript-eslint/no-extraneous-class */
	export class SSEClientTransport {
		constructor(
			url: URL,
			opts?: { requestInit?: { headers?: Record<string, string> } },
		)
	}
}

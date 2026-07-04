import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"

import { MCP_TRANSPORT_ENUM, SKILL_PROTOCOL_ENUM } from "@/db"
import type { SelectSkillProviderType } from "@/db"

import type {
	RawSkillToolType,
	SkillAdapterType,
	SkillCallResultType,
	SkillConnHandleType,
} from "../../types"

const buildTransport = (cfg: SelectSkillProviderType) => {
	const headers: Record<string, string> = {}
	if (cfg.auth?.kind === "bearer" && cfg.auth.token)
		headers.Authorization = `Bearer ${cfg.auth.token}`
	else if (
		cfg.auth?.kind === "headers" &&
		cfg.auth.headers &&
		typeof cfg.auth.headers === "object" &&
		!Array.isArray(cfg.auth.headers)
	)
		for (const [k, v] of Object.entries(cfg.auth.headers))
			if (typeof v === "string") headers[k] = v
	const url = new URL(cfg.url)
	const opts = { requestInit: { headers } }
	return cfg.type === MCP_TRANSPORT_ENUM.SSE
		? new SSEClientTransport(url, opts)
		: new StreamableHTTPClientTransport(url, opts)
}

const connect = async (
	cfg: SelectSkillProviderType,
): Promise<SkillConnHandleType> => {
	const client = new Client(
		{ name: "domia", version: "1.0.0" },
		{ capabilities: {} },
	)
	await client.connect(buildTransport(cfg), { timeout: cfg.timeout })

	const listTools = async (): Promise<RawSkillToolType[]> => {
		const listed = await client.listTools()
		return listed.tools.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema as Record<string, unknown> | undefined,
		}))
	}

	const callTool = async (
		rawName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<SkillCallResultType> => {
		const requestOptions: RequestOptions = { timeout: cfg.timeout, signal }
		const res = await client.callTool(
			{ name: rawName, arguments: args },
			undefined,
			requestOptions,
		)
		const text = (res.content ?? [])
			.filter((p) => p.type === "text" && typeof p.text === "string")
			.map((p) => p.text as string)
			.join("\n")
		const isError = Boolean(res.isError)
		return { text, status: isError ? "error" : "ok", isError }
	}

	return { listTools, callTool, close: () => client.close() }
}

export const mcpAdapter: SkillAdapterType = {
	protocol: SKILL_PROTOCOL_ENUM.MCP,
	connect,
}

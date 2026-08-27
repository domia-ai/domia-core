import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import {
	StdioClientTransport,
	getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js"
import {
	McpError,
	ErrorCode,
	ToolListChangedNotificationSchema,
	ElicitRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"

import {
	MCP_TRANSPORT_ENUM,
	SKILL_PROTOCOL_ENUM,
	DEFAULT_SKILL_MAX_LIST_PAGES,
	DEFAULT_SKILL_MAX_LISTED_TOOLS,
	DEFAULT_SKILL_MAX_TOTAL_TIMEOUT_MS,
} from "@/db"
import type { SelectSkillProviderType } from "@/db"
import { skillEngineLogger } from "@/utils"

import type {
	RawSkillToolType,
	SkillAdapterType,
	SkillCallResultType,
	SkillCallToolOptionsType,
	SkillConnHandleType,
	SkillConnHooksType,
} from "../../types"

const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/

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
	if (cfg.type === MCP_TRANSPORT_ENUM.STDIO) {
		if (cfg.trustTier !== "trusted")
			throw new Error("stdio transport requires a trusted provider")
		const command = cfg.config?.command?.trim()
		if (!command) throw new Error("stdio transport requires config.command")
		return new StdioClientTransport({
			command,
			args: cfg.config?.commandArgs ?? [],
			env: { ...getDefaultEnvironment(), ...(cfg.config?.commandEnv ?? {}) },
		})
	}
	const url = new URL(cfg.url)
	const opts = { requestInit: { headers } }
	return cfg.type === MCP_TRANSPORT_ENUM.SSE
		? new SSEClientTransport(url, opts)
		: new StreamableHTTPClientTransport(url, opts)
}

const splitContent = (
	content: { type?: string; text?: unknown; annotations?: unknown }[],
): { text: string; speakableText: string | null } => {
	const modelParts: string[] = []
	const userParts: string[] = []
	for (const part of content) {
		if (part.type !== "text" || typeof part.text !== "string") continue
		const audience = (part.annotations as { audience?: unknown } | undefined)
			?.audience
		if (Array.isArray(audience)) {
			if (audience.includes("user")) userParts.push(part.text)
			if (audience.includes("assistant")) modelParts.push(part.text)
		} else {
			modelParts.push(part.text)
		}
	}
	return {
		text: modelParts.length > 0 ? modelParts.join("\n") : userParts.join("\n"),
		speakableText: userParts.length > 0 ? userParts.join(" ") : null,
	}
}

const connect = async (
	cfg: SelectSkillProviderType,
	hooks?: SkillConnHooksType,
): Promise<SkillConnHandleType> => {
	const client = new Client(
		{ name: "domia", version: "1.0.0" },
		{ capabilities: hooks?.onElicit ? { elicitation: {} } : {} },
	)
	await client.connect(buildTransport(cfg), { timeout: cfg.timeout })
	const handlers = client as unknown as {
		setNotificationHandler: (schema: unknown, handler: () => void) => void
		setRequestHandler: (
			schema: unknown,
			handler: (req: {
				params?: {
					message?: string
					requestedSchema?: Record<string, unknown>
				}
			}) => Promise<Record<string, unknown>>,
		) => void
	}
	if (hooks?.onToolListChanged) {
		const notify = hooks.onToolListChanged
		handlers.setNotificationHandler(ToolListChangedNotificationSchema, () => {
			skillEngineLogger.info("🧩 tool list_changed notification", {
				provider: cfg.name,
			})
			notify()
		})
	}
	if (hooks?.onElicit) {
		const onElicit = hooks.onElicit
		handlers.setRequestHandler(ElicitRequestSchema, async (req) =>
			onElicit(req.params?.message ?? "", req.params?.requestedSchema),
		)
	}

	const listTools = async (): Promise<RawSkillToolType[]> => {
		const out: RawSkillToolType[] = []
		const seenCursors = new Set<string>()
		let cursor: string | undefined
		let truncated = false
		const deadline = Date.now() + DEFAULT_SKILL_MAX_TOTAL_TIMEOUT_MS
		for (let page = 0; page < DEFAULT_SKILL_MAX_LIST_PAGES; page++) {
			const listed = await (
				client as unknown as {
					listTools: (params?: { cursor?: string }) => Promise<{
						tools: {
							name: string
							description?: string
							inputSchema?: unknown
						}[]
						nextCursor?: string
					}>
				}
			).listTools(cursor !== undefined ? { cursor } : undefined)
			for (const t of listed.tools) {
				if (!TOOL_NAME_RE.test(t.name)) {
					skillEngineLogger.warn("mcp tool name rejected — invalid charset", {
						provider: cfg.name,
						tool: t.name.slice(0, 64),
					})
					continue
				}
				out.push({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema as Record<string, unknown> | undefined,
					outputSchema: (t as { outputSchema?: Record<string, unknown> })
						.outputSchema,
					annotations: (t as { annotations?: RawSkillToolType["annotations"] })
						.annotations,
				})
			}
			const next = (listed as { nextCursor?: string }).nextCursor
			if (next === undefined || next === null) return out
			if (
				seenCursors.has(next) ||
				Date.now() > deadline ||
				out.length >= DEFAULT_SKILL_MAX_LISTED_TOOLS
			) {
				truncated = true
				break
			}
			seenCursors.add(next)
			cursor = next
			if (page === DEFAULT_SKILL_MAX_LIST_PAGES - 1) truncated = true
		}
		if (truncated)
			skillEngineLogger.warn("mcp catalog truncated — defensive bounds hit", {
				provider: cfg.name,
				tools: out.length,
			})
		return out
	}

	const callTool = async (
		rawName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
		opts?: SkillCallToolOptionsType,
	): Promise<SkillCallResultType> => {
		const effectiveTimeout = opts?.timeoutMs ?? cfg.timeout
		const requestOptions: RequestOptions = {
			timeout: effectiveTimeout,
			signal,
			resetTimeoutOnProgress: true,
			maxTotalTimeout: Math.max(
				effectiveTimeout,
				DEFAULT_SKILL_MAX_TOTAL_TIMEOUT_MS,
			),
			...(opts?.onProgress
				? {
						onprogress: (p: { message?: string }) =>
							opts.onProgress?.(p.message ?? null),
					}
				: {}),
		}
		try {
			const res = await client.callTool(
				{ name: rawName, arguments: args },
				undefined,
				requestOptions,
			)
			const { text, speakableText } = splitContent(
				(res.content ?? []) as {
					type?: string
					text?: unknown
					annotations?: unknown
				}[],
			)
			const isError = Boolean(res.isError)
			return {
				text,
				status: isError ? "error" : "ok",
				isError,
				...(speakableText ? { speakableText } : {}),
				...((res as { structuredContent?: unknown }).structuredContent !==
				undefined
					? {
							structured: (res as { structuredContent?: unknown })
								.structuredContent,
						}
					: {}),
			}
		} catch (error) {
			if (signal?.aborted)
				return { text: "Cancelled.", status: "cancelled", isError: true }
			if (error instanceof McpError && error.code === ErrorCode.RequestTimeout)
				return {
					text: `Tool "${rawName}" timed out.`,
					status: "timeout",
					isError: true,
				}
			throw error
		}
	}

	return { listTools, callTool, close: () => client.close() }
}

export const mcpAdapter: SkillAdapterType = {
	protocol: SKILL_PROTOCOL_ENUM.MCP,
	connect,
}

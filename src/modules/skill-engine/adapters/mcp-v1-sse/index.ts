import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import {
	McpError,
	ErrorCode,
	CallToolResultSchema,
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

import {
	buildAuthHeaders,
	descriptorReaderOf,
	isAcceptedToolName,
	renderContent,
	validateElicitResult,
} from "../shared"
import type {
	RawSkillToolType,
	RawSkillToolListType,
	SkillAdapterType,
	SkillCallResultType,
	SkillCallToolOptionsType,
	SkillConnHandleType,
	SkillConnHooksType,
} from "../../types"

const REQUEST_TIMEOUT_CODE: number = ErrorCode.RequestTimeout

const buildTransport = (cfg: SelectSkillProviderType) =>
	new SSEClientTransport(new URL(cfg.url), {
		requestInit: { headers: buildAuthHeaders(cfg) },
	})

const connect = async (
	cfg: SelectSkillProviderType,
	hooks?: SkillConnHooksType,
): Promise<SkillConnHandleType> => {
	const client = new Client(
		{ name: "domia", version: "1.0.0" },
		{ capabilities: hooks?.onElicit ? { elicitation: {} } : {} },
	)
	await client.connect(buildTransport(cfg), { timeout: cfg.timeout })
	if (hooks?.onToolListChanged) {
		const notify = hooks.onToolListChanged
		client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
			skillEngineLogger.info("🧩 tool list_changed notification", {
				provider: cfg.name,
			})
			notify()
		})
	}
	if (hooks?.onElicit) {
		const onElicit = hooks.onElicit
		client.setRequestHandler(ElicitRequestSchema, async (req) =>
			validateElicitResult(
				await onElicit(
					req.params.message,
					"requestedSchema" in req.params
						? req.params.requestedSchema
						: undefined,
				),
				{ provider: cfg.name },
			),
		)
	}

	const listTools = async (): Promise<RawSkillToolListType> => {
		const out: RawSkillToolType[] = []
		const seenCursors = new Set<string>()
		let cursor: string | undefined
		let truncated = false
		const deadline = Date.now() + DEFAULT_SKILL_MAX_TOTAL_TIMEOUT_MS
		for (let page = 0; page < DEFAULT_SKILL_MAX_LIST_PAGES; page++) {
			const listed = await client.listTools(
				cursor !== undefined ? { cursor } : undefined,
			)
			for (const t of listed.tools) {
				if (out.length >= DEFAULT_SKILL_MAX_LISTED_TOOLS) {
					truncated = true
					break
				}
				if (!isAcceptedToolName(t.name)) {
					skillEngineLogger.warn("mcp tool name rejected — invalid charset", {
						provider: cfg.name,
						tool: t.name.slice(0, 64),
					})
					continue
				}
				out.push({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema,
					outputSchema: t.outputSchema,
					annotations: t.annotations,
				})
			}
			if (truncated) break
			const next = listed.nextCursor
			if (next === undefined) return { tools: out }
			if (seenCursors.has(next) || Date.now() > deadline) {
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
		return { tools: out }
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
				? { onprogress: (p) => opts.onProgress?.(p.message ?? null) }
				: {}),
		}
		try {
			const res = await client.callTool(
				{ name: rawName, arguments: args },
				CallToolResultSchema,
				requestOptions,
			)
			const { text, speakableText } = renderContent(
				res.content,
				res.structuredContent,
				{ provider: cfg.name, tool: rawName },
			)
			const isError = Boolean(res.isError)
			return {
				text,
				status: isError ? "error" : "ok",
				isError,
				...(speakableText ? { speakableText } : {}),
				...(res.structuredContent !== undefined
					? { structured: res.structuredContent }
					: {}),
			}
		} catch (error) {
			if (signal?.aborted)
				return { text: "Cancelled.", status: "cancelled", isError: true }
			if (error instanceof McpError && error.code === REQUEST_TIMEOUT_CODE)
				return {
					text: `Tool "${rawName}" timed out.`,
					status: "timeout",
					isError: true,
				}
			throw error
		}
	}

	const readDescriptor = descriptorReaderOf(cfg.name, {
		hasResources: () => client.getServerCapabilities()?.resources !== undefined,
		listResources: (cursor) =>
			client.listResources(cursor !== undefined ? { cursor } : undefined),
		readResource: (uri) => client.readResource({ uri }),
	})

	return { listTools, callTool, readDescriptor, close: () => client.close() }
}

export const mcpV1SseAdapter: SkillAdapterType = {
	protocol: SKILL_PROTOCOL_ENUM.MCP,
	transports: [MCP_TRANSPORT_ENUM.SSE],
	connect,
}

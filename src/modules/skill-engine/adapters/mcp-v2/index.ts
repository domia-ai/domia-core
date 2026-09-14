import {
	Client,
	SdkError,
	SdkErrorCode,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import type {
	CallToolRequestOptions,
	ClientOptions,
	ListToolsResult,
	VersionNegotiationOptions,
} from "@modelcontextprotocol/client"
import {
	StdioClientTransport,
	getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio"

import {
	MCP_PROTOCOL_MODE_ENUM,
	MCP_TRANSPORT_ENUM,
	SKILL_PROTOCOL_ENUM,
	DEFAULT_MCP_INPUT_REQUIRED_MAX_ROUNDS,
	DEFAULT_SKILL_MAX_LIST_PAGES,
	DEFAULT_SKILL_MAX_LISTED_TOOLS,
	DEFAULT_SKILL_MAX_TOTAL_TIMEOUT_MS,
} from "@/db"
import type { McpProtocolModeType, SelectSkillProviderType } from "@/db"
import { skillEngineLogger, domiaError, SKILL_ERRORS } from "@/utils"

import { resolveProtocolMode } from "../../utils/protocol"
import {
	buildAuthHeaders,
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
	SkillElicitResultType,
} from "../../types"

const buildTransport = (cfg: SelectSkillProviderType) => {
	if (cfg.type === MCP_TRANSPORT_ENUM.STDIO) {
		if (cfg.trustTier !== "trusted")
			throw domiaError(SKILL_ERRORS.INVALID_PROVIDER_CONFIG, {
				logger: skillEngineLogger,
				meta: { provider: cfg.name, reason: "stdio requires trusted tier" },
			})
		const command = cfg.config?.command?.trim()
		if (!command)
			throw domiaError(SKILL_ERRORS.INVALID_PROVIDER_CONFIG, {
				logger: skillEngineLogger,
				meta: { provider: cfg.name, reason: "stdio requires config.command" },
			})
		return new StdioClientTransport({
			command,
			args: cfg.config?.commandArgs ?? [],
			env: { ...getDefaultEnvironment(), ...(cfg.config?.commandEnv ?? {}) },
		})
	}
	return new StreamableHTTPClientTransport(new URL(cfg.url), {
		requestInit: { headers: buildAuthHeaders(cfg) },
	})
}

const isTimeout = (error: unknown): boolean =>
	error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout

const negotiationFor = (
	mode: McpProtocolModeType,
): VersionNegotiationOptions | null => {
	if (mode === MCP_PROTOCOL_MODE_ENUM.AUTO) return { mode: "auto" }
	if (mode === MCP_PROTOCOL_MODE_ENUM.MODERN)
		return { mode: { pin: MCP_PROTOCOL_MODE_ENUM.MODERN } }
	return null
}

export const mcpV2ClientOptions = (
	cfg: SelectSkillProviderType,
	hooks?: SkillConnHooksType,
): ClientOptions => {
	const negotiation = negotiationFor(resolveProtocolMode(cfg))
	const base: ClientOptions = {
		capabilities: hooks?.onElicit ? { elicitation: {} } : {},
		listMaxPages: DEFAULT_SKILL_MAX_LIST_PAGES,
	}
	if (!negotiation) return base
	const notify = hooks?.onToolListChanged
	return {
		...base,
		versionNegotiation: negotiation,
		inputRequired: {
			autoFulfill: true,
			maxRounds: DEFAULT_MCP_INPUT_REQUIRED_MAX_ROUNDS,
		},
		...(notify
			? {
					listChanged: {
						tools: {
							autoRefresh: false,
							debounceMs: 0,
							onChanged: () => notify(),
						},
					},
				}
			: {}),
	}
}

const withAnswerTimeout =
	(
		onElicit: NonNullable<SkillConnHooksType["onElicit"]>,
		cfg: SelectSkillProviderType,
	): NonNullable<SkillConnHooksType["onElicit"]> =>
	async (message, requestedSchema) => {
		const pending = { answered: false }
		const expiry = new Promise<SkillElicitResultType>((resolve) => {
			const timer = setTimeout(() => {
				if (pending.answered) return
				skillEngineLogger.warn("⏱️ mcp input request unanswered — cancelling", {
					provider: cfg.name,
					timeoutMs: cfg.timeout,
				})
				resolve({ action: "cancel" })
			}, cfg.timeout)
			if (typeof timer.unref === "function") timer.unref()
		})
		try {
			return await Promise.race([onElicit(message, requestedSchema), expiry])
		} finally {
			pending.answered = true
		}
	}

const cacheTtlMs = (listed: ListToolsResult): number | undefined => {
	const ttl = (listed as { ttlMs?: unknown }).ttlMs
	return typeof ttl === "number" && Number.isFinite(ttl) && ttl >= 0
		? ttl
		: undefined
}

const cacheScope = (listed: ListToolsResult): string | undefined => {
	const scope = (listed as { cacheScope?: unknown }).cacheScope
	return typeof scope === "string" ? scope : undefined
}

const connect = async (
	cfg: SelectSkillProviderType,
	hooks?: SkillConnHooksType,
): Promise<SkillConnHandleType> => {
	const mode = resolveProtocolMode(cfg)
	const isLegacyMode = mode === MCP_PROTOCOL_MODE_ENUM.LEGACY
	const client = new Client(
		{ name: "domia", version: "1.0.0" },
		mcpV2ClientOptions(cfg, hooks),
	)
	await client.connect(buildTransport(cfg), { timeout: cfg.timeout })
	if (isLegacyMode && hooks?.onToolListChanged) {
		const notify = hooks.onToolListChanged
		client.setNotificationHandler("notifications/tools/list_changed", () => {
			skillEngineLogger.info("🧩 tool list_changed notification", {
				provider: cfg.name,
			})
			notify()
		})
	}
	if (hooks?.onElicit) {
		const onElicit = isLegacyMode
			? hooks.onElicit
			: withAnswerTimeout(hooks.onElicit, cfg)
		client.setRequestHandler("elicitation/create", async (req) =>
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
		const listed = await client.listTools()
		const out: RawSkillToolType[] = []
		for (const t of listed.tools) {
			if (out.length >= DEFAULT_SKILL_MAX_LISTED_TOOLS) {
				skillEngineLogger.warn("mcp catalog truncated — defensive bounds hit", {
					provider: cfg.name,
					tools: out.length,
				})
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
		const ttlMs = cacheTtlMs(listed)
		if (ttlMs !== undefined)
			skillEngineLogger.debug("mcp tools/list cache hint", {
				provider: cfg.name,
				ttlMs,
				cacheScope: cacheScope(listed) ?? "private",
			})
		return { tools: out, ...(ttlMs === undefined ? {} : { ttlMs }) }
	}

	const callTool = async (
		rawName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
		opts?: SkillCallToolOptionsType,
	): Promise<SkillCallResultType> => {
		const effectiveTimeout = opts?.timeoutMs ?? cfg.timeout
		const requestOptions: CallToolRequestOptions = {
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
			if (isTimeout(error))
				return {
					text: `Tool "${rawName}" timed out.`,
					status: "timeout",
					isError: true,
				}
			throw error
		}
	}

	return {
		listTools,
		callTool,
		protocolEra: () => client.getProtocolEra() ?? null,
		close: () => client.close(),
	}
}

export const mcpV2Adapter: SkillAdapterType = {
	protocol: SKILL_PROTOCOL_ENUM.MCP,
	transports: [MCP_TRANSPORT_ENUM.HTTP, MCP_TRANSPORT_ENUM.STDIO],
	connect,
}

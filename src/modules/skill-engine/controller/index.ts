import {
	SKILL_TOOL_NAME_SEPARATOR,
	DEFAULT_SKILL_MAX_RESULT_CHARS,
	DEFAULT_SKILL_TRUST_TIER,
	TOOL_RUN_STATUS_ENUM,
	type SelectSkillProviderType,
	type SkillToolType,
	type ToolFinalizeRuleType,
	type ToolPolicyType,
} from "@/db"
import {
	skillEngineLogger,
	now,
	isExternalUrl,
	scanPiiEgress,
	getTraceContext,
	hashCanonical,
	sanitizeUntrustedText,
} from "@/utils"
import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import type { DomiaType } from "@/modules/core"

import dbAdapter from "../db-adapter"
import { resolveSkillAdapter } from "../adapters"
import { resolveSpecialization } from "../specializations"
import { resolveDescriptor } from "../utils/descriptor"
import {
	effectiveHints,
	deriveRiskClass,
	deriveDefaultPolicy,
	escalateRisk,
	escalatePolicy,
} from "../utils/risk"
import {
	breakerOpen,
	recordBreakerResult,
	isTransientStatus,
	backoffDelay,
	sleep,
} from "../utils/resilience"
import type {
	RawSkillToolType,
	SkillCallResultType,
	SkillCallStatusType,
	SkillConnectionType,
	ResolvedSkillResilienceType,
	ResolvedSkillDescriptorType,
	ResolvedToolMetaType,
	SkillConnHooksType,
	SkillElicitResultType,
} from "../types"

const connections = new Map<string, SkillConnectionType>()

const findConn = (
	domiaId: string,
	providerSlug: string,
): SkillConnectionType | undefined =>
	[...connections.values()].find(
		(c) => c.provider.domiaId === domiaId && c.providerSlug === providerSlug,
	)

export const getProviderResilience = (
	domiaId: string,
	providerSlug: string,
): ResolvedSkillResilienceType | null =>
	findConn(domiaId, providerSlug)?.descriptor.resilience ?? null

const splitName = (
	namespacedName: string,
): { providerSlug: string; rawName: string } => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	return {
		providerSlug: sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : "",
		rawName:
			sepIdx >= 0
				? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
				: namespacedName,
	}
}

const buildToolMeta = (
	tools: SkillToolType[],
	descriptor: ResolvedSkillDescriptorType,
	trustTier: string,
): Map<string, ResolvedToolMetaType> => {
	const meta = new Map<string, ResolvedToolMetaType>()
	for (const t of tools) {
		const override =
			descriptor.toolHints[t.rawName] ?? descriptor.toolHints["*"]
		const hints = effectiveHints(t.annotations, override, trustTier)
		const riskClass = deriveRiskClass(hints)
		const declaredPolicy =
			descriptor.toolPolicy[t.rawName] ?? descriptor.toolPolicy["*"]
		meta.set(t.rawName, {
			rawName: t.rawName,
			riskClass,
			idempotent: hints.idempotent === true,
			openWorld: hints.openWorld !== false,
			cancellable: override?.cancellable ?? true,
			policy: declaredPolicy ?? deriveDefaultPolicy(riskClass),
			policySource: declaredPolicy ? "descriptor" : "risk_default",
			timeoutMs: override?.timeoutMs ?? null,
			allowedActors: null,
		})
	}
	return meta
}

export const getToolPolicy = (
	domiaId: string,
	namespacedName: string,
): ToolPolicyType => {
	const { providerSlug, rawName } = splitName(namespacedName)
	const conn = findConn(domiaId, providerSlug)
	if (!conn) return "allow"
	return (
		conn.toolMeta.get(rawName)?.policy ??
		conn.descriptor.toolPolicy[rawName] ??
		conn.descriptor.toolPolicy["*"] ??
		"allow"
	)
}

export const getToolMeta = (
	domiaId: string,
	namespacedName: string,
): ResolvedToolMetaType | null => {
	const { providerSlug, rawName } = splitName(namespacedName)
	return findConn(domiaId, providerSlug)?.toolMeta.get(rawName) ?? null
}

export const getConnectionsFor = (domiaId: string): SkillConnectionType[] =>
	[...connections.values()].filter((c) => c.provider.domiaId === domiaId)

export const claimToolRunSpoken = (
	interactionId: string,
	namespacedName: string,
	resolvedArgs: Record<string, unknown> | undefined,
): boolean => {
	const runId = `${interactionId}:${namespacedName}:${hashCanonical(resolvedArgs ?? {})}:0`
	try {
		return dbAdapter.claimSpoken(runId)
	} catch (error) {
		skillEngineLogger.warn("tool_run spoken claim failed", { runId, error })
		return true
	}
}

export const unclaimToolRunSpoken = (
	interactionId: string,
	namespacedName: string,
	resolvedArgs: Record<string, unknown> | undefined,
): void => {
	const runId = `${interactionId}:${namespacedName}:${hashCanonical(resolvedArgs ?? {})}:0`
	try {
		dbAdapter.unclaimSpoken(runId).run()
	} catch (error) {
		skillEngineLogger.warn("tool_run spoken unclaim failed", { runId, error })
	}
}

export const markDispatchedToolRunsLost = (): void => {
	try {
		dbAdapter.markLostDispatched().run()
	} catch (error) {
		skillEngineLogger.warn("tool_run lost sweep failed", { error })
	}
}

export const getInvocationPolicy = (
	domiaId: string,
	namespacedName: string,
	resolvedArgs: Record<string, unknown>,
): { policy: ToolPolicyType; escalated: boolean } => {
	const { providerSlug, rawName } = splitName(namespacedName)
	const conn = findConn(domiaId, providerSlug)
	if (!conn) return { policy: "allow", escalated: false }
	const meta = conn.toolMeta.get(rawName)
	const basePolicy =
		meta?.policy ??
		conn.descriptor.toolPolicy[rawName] ??
		conn.descriptor.toolPolicy["*"] ??
		"allow"
	if (!conn.specialization?.invocationRisk || !meta)
		return { policy: basePolicy, escalated: false }
	const invocation = conn.specialization.invocationRisk(
		conn.provider,
		rawName,
		resolvedArgs,
	)
	const risk = escalateRisk(meta.riskClass, invocation)
	const policy =
		meta.policySource === "risk_default"
			? escalatePolicy(basePolicy, risk)
			: basePolicy
	return { policy, escalated: policy !== basePolicy }
}

const slugify = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "") || "skill"

const buildSlugMap = (
	providers: SelectSkillProviderType[],
): Map<string, string> => {
	const map = new Map<string, string>()
	const used = new Set<string>()
	for (const p of [...providers].sort((a, b) => (a.id < b.id ? -1 : 1))) {
		const base = slugify(p.name)
		let slug = base
		let n = 2
		while (used.has(slug)) slug = `${base}-${n++}`
		used.add(slug)
		map.set(p.id, slug)
	}
	return map
}

const refreshHooks = new Map<string, () => void>()
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const elicitPresenters = new Map<
	string,
	(
		message: string,
		requestedSchema: Record<string, unknown> | undefined,
	) => Promise<SkillElicitResultType>
>()

export const setSkillsRefreshHook = (domiaId: string, fn: () => void): void => {
	refreshHooks.set(domiaId, fn)
}

export const clearSkillsRefreshHook = (domiaId: string): void => {
	refreshHooks.delete(domiaId)
	const timer = refreshTimers.get(domiaId)
	if (timer) clearTimeout(timer)
	refreshTimers.delete(domiaId)
}

export const setElicitationPresenter = (
	domiaId: string,
	fn: (
		message: string,
		requestedSchema: Record<string, unknown> | undefined,
	) => Promise<SkillElicitResultType>,
): void => {
	elicitPresenters.set(domiaId, fn)
}

export const clearElicitationPresenter = (domiaId: string): void => {
	elicitPresenters.delete(domiaId)
}

const REFRESH_DEBOUNCE_MS = 2000

const scheduleToolRefresh = (domiaId: string): void => {
	if (refreshTimers.has(domiaId)) return
	const timer = setTimeout(() => {
		refreshTimers.delete(domiaId)
		refreshHooks.get(domiaId)?.()
	}, REFRESH_DEBOUNCE_MS)
	if (typeof timer.unref === "function") timer.unref()
	refreshTimers.set(domiaId, timer)
}

const connHooksFor = (cfg: SelectSkillProviderType): SkillConnHooksType => ({
	onToolListChanged: () => scheduleToolRefresh(cfg.domiaId),
	onElicit: async (message, requestedSchema) => {
		const presenter = elicitPresenters.get(cfg.domiaId)
		if (!presenter) return { action: "decline" }
		try {
			return await presenter(message, requestedSchema)
		} catch (err) {
			skillEngineLogger.warn("elicitation presenter failed", {
				provider: cfg.name,
				err,
			})
			return { action: "cancel" }
		}
	},
})

export const connectProvider = async (
	cfg: SelectSkillProviderType,
	slug: string,
	language: string | null = null,
): Promise<boolean> => {
	const adapter = resolveSkillAdapter(cfg.protocol)
	if (!adapter) {
		skillEngineLogger.warn("no adapter for protocol", {
			provider: cfg.name,
			protocol: cfg.protocol,
		})
		return false
	}
	try {
		const handle = await adapter.connect(cfg, connHooksFor(cfg))
		const specialization = resolveSpecialization(cfg)
		if (specialization?.onConnected)
			void Promise.resolve(specialization.onConnected(cfg, handle)).catch(
				(err) =>
					skillEngineLogger.warn("specialization onConnected failed", {
						provider: cfg.name,
						err,
					}),
			)
		const descriptor = resolveDescriptor(cfg, language)
		connections.set(cfg.id, {
			providerId: cfg.id,
			providerSlug: slug,
			name: cfg.name,
			maxResultChars: cfg.maxResultChars ?? DEFAULT_SKILL_MAX_RESULT_CHARS,
			timeoutMs: cfg.timeout,
			allowedTools: new Set((cfg.toolsCache ?? []).map((t) => t.rawName)),
			descriptor,
			toolMeta: buildToolMeta(
				cfg.toolsCache ?? [],
				descriptor,
				cfg.trustTier ?? DEFAULT_SKILL_TRUST_TIER,
			),
			language,
			provider: cfg,
			specialization,
			handle,
		})
		return true
	} catch (error) {
		skillEngineLogger.warn("skill connect failed", {
			provider: cfg.name,
			error,
		})
		return false
	}
}

export const connectAll = async (domia: DomiaType): Promise<void> => {
	const active = (domia.skillProviders ?? []).filter((s) => s.isActive)
	const activeIds = new Set(active.map((s) => s.id))
	const stale = [...connections.values()]
		.filter(
			(c) => c.provider.domiaId === domia.id && !activeIds.has(c.providerId),
		)
		.map((c) => c.providerId)
	if (stale.length > 0) {
		skillEngineLogger.info(`disconnecting ${stale.length} stale provider(s)`, {
			domiaId: domia.id,
		})
		await disconnectProviders(stale)
	}
	const slugMap = buildSlugMap(active)
	const toConnect = active.filter((s) => !connections.has(s.id))
	if (toConnect.length === 0) return
	const language = domia.characterProfile?.language ?? null
	await Promise.allSettled(
		toConnect.map((s) =>
			connectProvider(s, slugMap.get(s.id) ?? slugify(s.name), language),
		),
	)
}

const fireOnDisconnected = (conn: SkillConnectionType): void => {
	const hook = conn.specialization?.onDisconnected
	if (!hook) return
	void (async () => hook(conn.provider))().catch((err) =>
		skillEngineLogger.warn("specialization onDisconnected failed", {
			provider: conn.name,
			err,
		}),
	)
}

export const disconnectAll = async (): Promise<void> => {
	const all = [...connections.values()]
	connections.clear()
	for (const conn of all) fireOnDisconnected(conn)
	await Promise.allSettled(all.map((c) => c.handle.close()))
}

export const disconnectProviders = async (ids: string[]): Promise<void> => {
	const closing: Promise<unknown>[] = []
	for (const id of ids) {
		const conn = connections.get(id)
		if (!conn) continue
		connections.delete(id)
		fireOnDisconnected(conn)
		closing.push(conn.handle.close())
	}
	await Promise.allSettled(closing)
}

export const resolveToolFinalize = (
	domiaId: string,
	namespacedName: string,
): ToolFinalizeRuleType | null => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	const providerSlug = sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : ""
	const rawName =
		sepIdx >= 0
			? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
			: namespacedName
	const conn = [...connections.values()].find(
		(c) =>
			c.provider.domiaId === domiaId &&
			c.providerSlug === providerSlug &&
			c.allowedTools.has(rawName),
	)
	if (!conn) return null
	return (
		conn.descriptor.finalize[rawName] ?? conn.descriptor.finalize["*"] ?? null
	)
}

const pruneSchemaParams = (
	schema: Record<string, unknown>,
	allow: string[],
): Record<string, unknown> => {
	const props = schema.properties as Record<string, unknown> | undefined
	if (!props) return schema
	const kept: Record<string, unknown> = {}
	for (const key of Object.keys(props))
		if (allow.includes(key)) kept[key] = props[key]
	const required = Array.isArray(schema.required)
		? (schema.required as string[]).filter((r) => allow.includes(r))
		: undefined
	return { ...schema, properties: kept, ...(required ? { required } : {}) }
}

const toCachedTools = (
	conn: SkillConnectionType,
	raw: RawSkillToolType[],
	whitelist: string[] | null,
	paramAllow: Record<string, string[]> | null,
): SkillToolType[] =>
	raw
		.filter((t) => !whitelist || whitelist.includes(t.name))
		.map((t) => {
			const schema = t.inputSchema ?? { type: "object", properties: {} }
			const allow = paramAllow?.[t.name] ?? paramAllow?.["*"]
			return {
				provider: conn.providerSlug,
				rawName: t.name,
				namespacedName: `${conn.providerSlug}${SKILL_TOOL_NAME_SEPARATOR}${t.name}`,
				description: t.description,
				inputSchema: allow ? pruneSchemaParams(schema, allow) : schema,
				...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
				...(t.annotations ? { annotations: t.annotations } : {}),
			}
		})

export const listTools = async (domia: DomiaType): Promise<SkillToolType[]> => {
	const providers = (domia.skillProviders ?? []).filter((s) => s.isActive)
	const result: SkillToolType[] = []
	for (const cfg of providers) {
		const conn = connections.get(cfg.id)
		if (!conn) {
			if (cfg.toolsCache?.length) result.push(...cfg.toolsCache)
			continue
		}
		try {
			const listed = await conn.handle.listTools()
			const paramAllow = conn.descriptor.paramAllow
			const tools = toCachedTools(
				conn,
				listed,
				cfg.toolWhitelist ?? null,
				Object.keys(paramAllow).length ? paramAllow : null,
			)
			conn.allowedTools = new Set(tools.map((t) => t.rawName))
			const syncedAt = now()
			dbAdapter.cacheTools(cfg.id, tools, syncedAt).run()
			conn.provider = { ...cfg, toolsCache: tools, lastSyncAt: syncedAt }
			conn.descriptor = resolveDescriptor(conn.provider, conn.language)
			conn.toolMeta = buildToolMeta(
				tools,
				conn.descriptor,
				cfg.trustTier ?? DEFAULT_SKILL_TRUST_TIER,
			)
			result.push(...tools)
		} catch (error) {
			skillEngineLogger.warn("skill listTools failed — dropping connection", {
				provider: cfg.name,
				error,
			})
			connections.delete(cfg.id)
			fireOnDisconnected(conn)
			void conn.handle.close().catch(() => undefined)
			if (cfg.toolsCache?.length) result.push(...cfg.toolsCache)
		}
	}
	return result
}

export const resolveSkillArgs = async (
	domiaId: string,
	namespacedName: string,
	args: Record<string, unknown>,
): Promise<{
	ok: boolean
	resolvedArgs: Record<string, unknown>
	error?: string
}> => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	const providerSlug = sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : ""
	const rawName =
		sepIdx >= 0
			? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
			: namespacedName
	const conn = [...connections.values()].find(
		(c) =>
			c.provider.domiaId === domiaId &&
			c.providerSlug === providerSlug &&
			c.allowedTools.has(rawName),
	)
	if (!conn) return { ok: false, resolvedArgs: args, error: "tool unavailable" }
	if (!conn.specialization?.resolveArgs) return { ok: true, resolvedArgs: args }
	try {
		const resolvedArgs = await conn.specialization.resolveArgs(
			conn.provider,
			rawName,
			args,
			conn.language,
		)
		return { ok: true, resolvedArgs }
	} catch (error) {
		return {
			ok: false,
			resolvedArgs: args,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export const callTool = async (
	domiaId: string,
	namespacedName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
	preResolved = false,
): Promise<SkillCallResultType> => {
	const sepIdx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	const providerSlug = sepIdx >= 0 ? namespacedName.slice(0, sepIdx) : ""
	const rawName =
		sepIdx >= 0
			? namespacedName.slice(sepIdx + SKILL_TOOL_NAME_SEPARATOR.length)
			: namespacedName
	const breakerKey = `${domiaId}:${providerSlug}`
	const candidates = [...connections.values()].filter(
		(c) => c.provider.domiaId === domiaId && c.providerSlug === providerSlug,
	)
	const conn = candidates.find((c) => c.allowedTools.has(rawName))
	if (!conn) {
		if (candidates.length > 0) {
			skillEngineLogger.warn("skill callTool rejected — tool not authorized", {
				tool: namespacedName,
			})
			return {
				text: `Tool "${rawName}" is not available.`,
				status: "unauthorized",
				isError: true,
				resolvedArgs: args,
			}
		}
		return {
			text: `Tool unavailable: ${providerSlug || "home"} is offline.`,
			status: "error",
			isError: true,
			resolvedArgs: args,
		}
	}
	const policy =
		conn.toolMeta.get(rawName)?.policy ??
		conn.descriptor.toolPolicy[rawName] ??
		conn.descriptor.toolPolicy["*"]
	if (policy === "block") {
		skillEngineLogger.warn("skill callTool blocked by policy", {
			tool: namespacedName,
		})
		return {
			text: `Action "${rawName}" is blocked by policy.`,
			status: "blocked",
			isError: true,
			resolvedArgs: args,
		}
	}
	if (policy === "confirm" && !preResolved) {
		skillEngineLogger.warn("skill callTool requires confirmation — not run", {
			tool: namespacedName,
		})
		return {
			text: `Action "${rawName}" needs the user's confirmation and was not run.`,
			status: "blocked",
			isError: true,
			resolvedArgs: args,
		}
	}
	const {
		retryMaxAttempts,
		retryBackoffMs,
		breakerThreshold,
		breakerCooldownMs,
	} = conn.descriptor.resilience
	if (breakerOpen(breakerKey, breakerThreshold)) {
		skillEngineLogger.warn("skill callTool short-circuited — breaker open", {
			tool: namespacedName,
		})
		return {
			text: `Service "${providerSlug || "home"}" is temporarily unavailable.`,
			status: "error",
			isError: true,
			resolvedArgs: args,
		}
	}
	let resolvedArgs: Record<string, unknown>
	try {
		resolvedArgs =
			preResolved || !conn.specialization?.resolveArgs
				? args
				: await conn.specialization.resolveArgs(
						conn.provider,
						rawName,
						args,
						conn.language,
					)
	} catch (error) {
		skillEngineLogger.warn("skill callTool resolveArgs failed", {
			tool: namespacedName,
			error,
		})
		return {
			text: `Could not resolve the target for "${rawName}": ${error instanceof Error ? error.message : String(error)}.`,
			status: "error",
			isError: true,
			resolvedArgs: args,
		}
	}
	if (!preResolved && conn.specialization?.invocationRisk) {
		const meta = conn.toolMeta.get(rawName)
		if (meta && meta.policySource === "risk_default") {
			const invocation = conn.specialization.invocationRisk(
				conn.provider,
				rawName,
				resolvedArgs,
			)
			const escalated = escalatePolicy(
				meta.policy,
				escalateRisk(meta.riskClass, invocation),
			)
			if (escalated === "confirm") {
				skillEngineLogger.warn(
					"skill callTool escalated to confirmation — not run",
					{ tool: namespacedName },
				)
				return {
					text: `Action "${rawName}" needs the user's confirmation and was not run.`,
					status: "blocked",
					isError: true,
					resolvedArgs,
				}
			}
		}
	}
	skillEngineLogger.info(`🔧 ${rawName} ${JSON.stringify(resolvedArgs)}`)

	const traceCtx = getTraceContext()
	const argsHash = hashCanonical(resolvedArgs)
	const auditMeta = conn.toolMeta.get(rawName)
	const runId = traceCtx?.interactionId
		? `${traceCtx.interactionId}:${namespacedName}:${argsHash}:0`
		: null
	if (runId && traceCtx?.interactionId) {
		const claimed = dbAdapter.claimToolRun({
			id: runId,
			domiaId,
			interactionId: traceCtx.interactionId,
			tool: namespacedName,
			providerSlug,
			argsHash,
			riskClass: auditMeta?.riskClass ?? null,
			policyDecision: policy ?? "allow",
			policySource: auditMeta?.policySource ?? null,
		})
		if (!claimed) {
			skillEngineLogger.warn("skill callTool duplicate claim — suppressed", {
				tool: namespacedName,
			})
			return {
				text: `Duplicate call to "${rawName}" was suppressed.`,
				status: "blocked",
				isError: true,
				resolvedArgs,
			}
		}
		emitTurnEvent({
			type: DOMIA_TURN_EVENT_ENUM.TOOL_STARTED,
			interactionId: traceCtx.interactionId,
			originDomiaKey: traceCtx.originDomiaKey ?? "",
			traceId: traceCtx.traceId,
			toolName: namespacedName,
			provider: providerSlug || undefined,
			riskClass: auditMeta?.riskClass,
			policyDecision: policy ?? "allow",
			argsHash,
		})
	}
	const runStartedAt = Date.now()
	const settleRun = (status: SkillCallStatusType): void => {
		if (!runId) return
		const mapped =
			status === "ok"
				? TOOL_RUN_STATUS_ENUM.OK
				: status === "timeout"
					? TOOL_RUN_STATUS_ENUM.TIMEOUT
					: status === "cancelled"
						? TOOL_RUN_STATUS_ENUM.CANCELLED
						: TOOL_RUN_STATUS_ENUM.FAILED
		try {
			dbAdapter.settleToolRun(runId, mapped, Date.now() - runStartedAt).run()
		} catch (error) {
			skillEngineLogger.warn("tool_run settle failed", { runId, error })
		}
	}

	if (isExternalUrl(conn.provider.url)) {
		const pii = scanPiiEgress(resolvedArgs)
		if (pii.length) {
			skillEngineLogger.warn("PII egress to external MCP provider", {
				tool: namespacedName,
				url: conn.provider.url,
				kinds: pii,
			})
		}
	}

	const meta = conn.toolMeta.get(rawName)
	const effectiveTimeoutMs = meta?.timeoutMs ?? conn.timeoutMs
	const retryAllowed = meta?.idempotent === true
	const maxAttempts = retryAllowed ? Math.max(1, retryMaxAttempts) : 1
	const cancellable = meta?.cancellable !== false
	let transportError: unknown = null
	let sawTimeout = false
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (attempt > 0) {
			skillEngineLogger.warn(
				`skill callTool transient — retry ${attempt}/${maxAttempts - 1}`,
				{ tool: namespacedName },
			)
			await sleep(backoffDelay(attempt, retryBackoffMs), signal)
		}
		if (signal?.aborted) break
		const deadline = new AbortController()
		const timer = setTimeout(() => deadline.abort(), effectiveTimeoutMs + 250)
		timer.unref?.()
		const attemptSignals = [deadline.signal]
		if (cancellable && signal) attemptSignals.push(signal)
		const attemptSignal =
			attemptSignals.length === 1
				? attemptSignals[0]
				: AbortSignal.any(attemptSignals)
		try {
			const res = await conn.handle.callTool(
				rawName,
				resolvedArgs,
				attemptSignal,
				{ timeoutMs: effectiveTimeoutMs },
			)
			if (res.structured !== undefined) {
				const outputSchema = (conn.provider.toolsCache ?? []).find(
					(t) => t.rawName === rawName,
				)?.outputSchema
				const required = outputSchema?.required
				if (
					Array.isArray(required) &&
					(typeof res.structured !== "object" ||
						res.structured === null ||
						required.some(
							(k) =>
								typeof k === "string" &&
								!(k in (res.structured as Record<string, unknown>)),
						))
				)
					skillEngineLogger.warn(
						"structuredContent does not satisfy outputSchema required keys",
						{ tool: namespacedName },
					)
			}
			if (res.status === "cancelled") {
				if (signal?.aborted) break
				sawTimeout = true
				transportError = null
				continue
			}
			if (isTransientStatus(res.status)) {
				sawTimeout = true
				transportError = null
				continue
			}
			recordBreakerResult(breakerKey, true, breakerThreshold, breakerCooldownMs)
			settleRun(res.status)
			const truncated =
				res.text.length > conn.maxResultChars
					? `${res.text.slice(0, conn.maxResultChars)}…[truncated]`
					: res.text
			const speakable = res.speakableText
				? sanitizeUntrustedText(res.speakableText, { maxLength: 500 }).text
				: undefined
			return {
				text: truncated || "(no output)",
				status: res.status,
				isError: res.isError,
				resolvedArgs,
				...(speakable ? { speakableText: speakable } : {}),
				...(res.structured !== undefined ? { structured: res.structured } : {}),
			}
		} catch (error) {
			transportError = error
			if (deadline.signal.aborted && !signal?.aborted) {
				sawTimeout = true
				transportError = null
			}
			if (signal?.aborted) break
		} finally {
			clearTimeout(timer)
		}
	}

	if (signal?.aborted) {
		skillEngineLogger.info("skill callTool cancelled by caller", {
			tool: namespacedName,
		})
		settleRun("cancelled")
		return {
			text: `Tool "${rawName}" was cancelled.`,
			status: "cancelled",
			isError: true,
			resolvedArgs,
		}
	}

	if (sawTimeout && transportError == null) {
		recordBreakerResult(breakerKey, false, breakerThreshold, breakerCooldownMs)
		skillEngineLogger.warn("skill callTool timed out", {
			tool: namespacedName,
			timeoutMs: effectiveTimeoutMs,
		})
		settleRun("timeout")
		return {
			text: `Tool "${rawName}" timed out.`,
			status: "timeout",
			isError: true,
			resolvedArgs,
		}
	}
	recordBreakerResult(breakerKey, false, breakerThreshold, breakerCooldownMs)
	skillEngineLogger.warn("skill callTool failed", {
		tool: namespacedName,
		error: transportError,
	})
	settleRun("error")
	return {
		text: `Tool "${rawName}" failed.`,
		status: "error",
		isError: true,
		resolvedArgs,
	}
}

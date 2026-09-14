import { SKILL_TOOL_NAME_SEPARATOR, TOOL_RUN_STATUS_ENUM } from "@/db"
import {
	skillEngineLogger,
	isExternalUrl,
	scanPiiEgress,
	getTraceContext,
	hashCanonical,
	sanitizeUntrustedText,
} from "@/utils"
import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"

import dbAdapter from "../db-adapter"
import { normalizeArgs } from "../utils/arg-normalize"
import { escalateRisk, escalatePolicy } from "../utils/risk"
import {
	breakerOpen,
	recordBreakerResult,
	isTransientStatus,
	backoffDelay,
	sleep,
} from "../utils/resilience"
import type {
	SkillCallResultType,
	SkillCallStatusType,
	SkillConnectionType,
} from "../types"

import { connections } from "./state"
import { declaredToolPolicy } from "./registry"

const runPreCall = async (
	conn: SkillConnectionType,
	rawName: string,
	args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
	const hook = conn.specialization?.preCall
	if (!hook) return args
	try {
		return await hook(conn.provider, rawName, args)
	} catch (error) {
		skillEngineLogger.warn("specialization preCall failed — args unchanged", {
			provider: conn.name,
			tool: rawName,
			error,
		})
		return args
	}
}

const runPostCall = async (
	conn: SkillConnectionType,
	rawName: string,
	resolvedArgs: Record<string, unknown>,
	result: SkillCallResultType,
): Promise<SkillCallResultType> => {
	const hook = conn.specialization?.postCall
	if (!hook) return result
	try {
		return await hook(
			conn.provider,
			rawName,
			resolvedArgs,
			result,
			conn.language,
		)
	} catch (error) {
		skillEngineLogger.warn(
			"specialization postCall failed — result unchanged",
			{
				provider: conn.name,
				tool: rawName,
				error,
			},
		)
		return result
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
		declaredToolPolicy(conn.descriptor, rawName)
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
	const intercepted = conn.specialization?.interceptToolCall?.(
		conn.provider,
		rawName,
		args,
	)
	if (intercepted) {
		skillEngineLogger.debug("skill callTool served locally by specialization", {
			tool: namespacedName,
		})
		return {
			text: intercepted.text,
			status: "ok",
			isError: false,
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
	const normalizedArgs = preResolved
		? args
		: normalizeArgs(conn.descriptor.argNormalize, rawName, args)
	let resolvedArgs: Record<string, unknown>
	try {
		resolvedArgs =
			preResolved || !conn.specialization?.resolveArgs
				? normalizedArgs
				: await conn.specialization.resolveArgs(
						conn.provider,
						rawName,
						normalizedArgs,
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
			resolvedArgs: normalizedArgs,
		}
	}
	if (!preResolved && conn.specialization?.invocationRisk) {
		const meta = conn.toolMeta.get(rawName)
		if (meta?.policySource === "risk_default") {
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
	resolvedArgs = await runPreCall(conn, rawName, resolvedArgs)
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
			policyDecision: policy,
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
			policyDecision: policy,
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
		timer.unref()
		const attemptSignals = [deadline.signal]
		if (cancellable && signal) attemptSignals.push(signal)
		const attemptSignal =
			attemptSignals.length === 1
				? attemptSignals[0]
				: AbortSignal.any(attemptSignals)
		try {
			const res = await runPostCall(
				conn,
				rawName,
				resolvedArgs,
				await (conn.specialization?.callVirtualTool?.(
					conn.provider,
					conn.handle,
					rawName,
					resolvedArgs,
					conn.language,
					attemptSignal,
				) ??
					conn.handle.callTool(rawName, resolvedArgs, attemptSignal, {
						timeoutMs: effectiveTimeoutMs,
					})),
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

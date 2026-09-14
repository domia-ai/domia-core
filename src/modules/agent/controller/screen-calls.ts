import { DEFAULT_CONSTRAINED_REPAIR_ENABLED } from "@/db"
import { coerceArgsToSchema, parseLlmJson, agentLogger } from "@/utils"
import type { ToolCallType } from "@/modules/llm-engine"
import { sanitizeJsonSchema } from "@/modules/llm-engine"

import { callSignature } from "../utils"
import type {
	AgentTurnContextType,
	ScreenedBatchType,
	ScreenedCallType,
} from "../types"
import { pruneEmptyArgs, filterToAllowed } from "./helpers"
import { resolveCallPolicy } from "./call-policy"

const prepareCallArgs = async (
	ctx: AgentTurnContextType,
	call: ToolCallType,
	advertisedName: string,
): Promise<{ safeArgs: Record<string, unknown>; missing: string[] }> => {
	const safeArgs = coerceArgsToSchema(
		pruneEmptyArgs(
			filterToAllowed(call.arguments, ctx.allowedParams.get(call.name)),
		),
		ctx.toolSchemas.get(call.name),
	)
	call.arguments = safeArgs
	const missing = (ctx.requiredParams.get(call.name) ?? []).filter(
		(k) => safeArgs[k] === undefined,
	)
	if (
		missing.length === 0 ||
		!ctx.opts?.constrainedRepair ||
		!(
			ctx.domia.llmModelConfig?.constrainedRepairEnabled ??
			DEFAULT_CONSTRAINED_REPAIR_ENABLED
		) ||
		ctx.argCorrected.has(call.name)
	)
		return { safeArgs, missing }
	const schema = sanitizeJsonSchema(ctx.toolSchemas.get(call.name) ?? {})
	if (!schema) return { safeArgs, missing }
	const raw = await ctx.opts
		.constrainedRepair(
			`Produce JSON arguments for the tool "${advertisedName}" to satisfy this request: "${ctx.transcript}". The model previously sent ${JSON.stringify(safeArgs)} which is missing: ${missing.join(", ")}. Respond with a single JSON object.`,
			schema,
		)
		.catch((err: unknown) => {
			agentLogger.warn("constrained argument repair failed", {
				err,
				tool: call.name,
			})
			return null
		})
	if (!raw) return { safeArgs, missing }
	const { value } = parseLlmJson(raw)
	if (!value) return { safeArgs, missing }
	const repaired = coerceArgsToSchema(
		pruneEmptyArgs(
			filterToAllowed(
				{ ...safeArgs, ...value },
				ctx.allowedParams.get(call.name),
			),
		),
		ctx.toolSchemas.get(call.name),
	)
	const stillMissing = (ctx.requiredParams.get(call.name) ?? []).filter(
		(k) => repaired[k] === undefined,
	)
	if (stillMissing.length > 0) return { safeArgs, missing }
	agentLogger.info("constrained repair filled missing args", {
		domiaId: ctx.domia.id,
		name: call.name,
	})
	Object.assign(safeArgs, repaired)
	call.arguments = safeArgs
	return { safeArgs, missing: [] }
}

export const screenToolCalls = async (
	ctx: AgentTurnContextType,
	calls: ToolCallType[],
	injectedRetry: boolean,
): Promise<ScreenedBatchType> => {
	const callMessages: (string | null)[] = calls.map(() => null)
	const toRun: ScreenedCallType[] = []
	let allTemplate = true
	for (let ci = 0; ci < calls.length; ci++) {
		const call = calls[ci]
		if (call.argsInvalid) {
			allTemplate = false
			callMessages[ci] =
				`Error: the arguments for "${call.name}" were not valid JSON. Call it again with well-formed JSON arguments.`
			agentLogger.warn("agent tool call had unparseable args — rejected", {
				domiaId: ctx.domia.id,
				name: call.name,
			})
			continue
		}
		if (!call.name.trim() || call.name === "__blank__") {
			allTemplate = false
			callMessages[ci] =
				`Do not echo tool-call syntax from earlier content. Answer the user directly in plain language.`
			agentLogger.warn("agent emitted a blank tool name — anti-priming", {
				domiaId: ctx.domia.id,
			})
			continue
		}
		const resolvedName = ctx.namespacedOf(call.name)
		if (!resolvedName) {
			allTemplate = false
			callMessages[ci] =
				`Error: no tool named "${call.name}" exists. Available tools: ${ctx.aliasMap.aliases.join(", ")}. Pick one of these or reply without a tool.`
			agentLogger.warn("agent called unknown tool — corrected", {
				domiaId: ctx.domia.id,
				name: call.name,
			})
			continue
		}
		if (
			call.name !== resolvedName &&
			call.name !== ctx.aliasMap.aliasOf(resolvedName)
		)
			agentLogger.warn("agent tool name recovered from a near-miss", {
				domiaId: ctx.domia.id,
				emitted: call.name,
				resolved: resolvedName,
			})
		call.name = resolvedName
		const advertisedName = ctx.aliasMap.aliasOf(resolvedName)
		const { safeArgs, missing } = await prepareCallArgs(
			ctx,
			call,
			advertisedName,
		)
		if (missing.length > 0) {
			allTemplate = false
			const retry = ctx.argCorrected.has(call.name)
			ctx.argCorrected.add(call.name)
			if (retry) ctx.forceNoTool = true
			callMessages[ci] = retry
				? `Error: "${advertisedName}" is still missing required argument(s): ${missing.join(", ")}. Do not call it again — tell the user you need ${missing.join(" and ")}.`
				: `Error: "${advertisedName}" is missing required argument(s): ${missing.join(", ")}. You sent ${JSON.stringify(safeArgs)}. Call "${advertisedName}" again with ${missing.join(" and ")} filled in.`
			agentLogger.warn("agent tool call missing required args", {
				domiaId: ctx.domia.id,
				name: call.name,
				missing,
				retry,
			})
			continue
		}
		const key = callSignature(call.name, safeArgs)
		if (toRun.some((r) => callSignature(r.call.name, r.safeArgs) === key)) {
			callMessages[ci] =
				`Duplicate of a call already in this batch — executed once.`
			continue
		}
		const verdict = await resolveCallPolicy(
			ctx,
			call,
			safeArgs,
			advertisedName,
			injectedRetry,
		)
		if (verdict.kind === "confirm")
			return { toRun, callMessages, allTemplate, confirmTarget: verdict.target }
		if (verdict.kind !== "run") {
			allTemplate = false
			callMessages[ci] = verdict.message
			continue
		}
		const guardVerdict = ctx.guards.onCallAttempt(call.name, safeArgs)
		if (guardVerdict.action === "block") {
			allTemplate = false
			callMessages[ci] = guardVerdict.syntheticResult ?? "Call blocked."
			if (guardVerdict.forceNoTool) ctx.forceNoTool = true
			agentLogger.warn("agent tool call blocked by guard", {
				domiaId: ctx.domia.id,
				name: call.name,
			})
			continue
		}
		toRun.push({ idx: ci, call, safeArgs })
	}
	return { toRun, callMessages, allTemplate, confirmTarget: null }
}

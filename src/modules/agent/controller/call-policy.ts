import { agentLogger } from "@/utils"
import type { ToolCallType } from "@/modules/llm-engine"
import {
	resolveSkillArgs,
	getToolPolicy,
	getInvocationPolicy,
	getToolMeta,
	describeInvocation,
	inferWriteTarget,
	screenToolCall,
} from "@/modules/skill-engine"

import { MISSING_DETAIL_NUDGE } from "../constants"
import { targetMentioned } from "../utils"
import type {
	AgentTurnContextType,
	CallPolicyVerdictType,
	ConfirmTargetType,
} from "../types"

export const resolveCallPolicy = async (
	ctx: AgentTurnContextType,
	call: ToolCallType,
	safeArgs: Record<string, unknown>,
	advertisedName: string,
	injectedRetry: boolean,
): Promise<CallPolicyVerdictType> => {
	const screened = await screenToolCall(
		ctx.domia.id,
		call.name,
		safeArgs,
		ctx.transcript,
	)
	if (screened.kind === "reject") {
		ctx.forceNoTool = true
		agentLogger.warn("agent tool call rejected — target does not exist", {
			domiaId: ctx.domia.id,
			name: call.name,
			reason: screened.reason,
		})
		return {
			kind: "blocked",
			message: `Blocked: ${screened.reason}. Do not call a tool again — answer the user directly.`,
		}
	}
	if (screened.kind === "redirect") {
		agentLogger.warn("agent tool call redirected to what the user said", {
			domiaId: ctx.domia.id,
			from: call.name,
			to: screened.namespacedName,
		})
		for (const key of Object.keys(safeArgs))
			if (!Object.hasOwn(screened.args, key))
				Reflect.deleteProperty(safeArgs, key)
		call.name = screened.namespacedName
		call.arguments = safeArgs
	}
	const basePolicy = getToolPolicy(ctx.domia.id, call.name)
	if (basePolicy === "block") {
		agentLogger.warn("agent tool call rejected — policy block", {
			domiaId: ctx.domia.id,
			name: call.name,
		})
		return {
			kind: "blocked",
			message: `Action "${advertisedName}" is blocked by policy and was not run. Tell the user this action is not allowed.`,
		}
	}
	const callMeta = getToolMeta(ctx.domia.id, call.name)
	if (
		ctx.targetGuard &&
		!injectedRetry &&
		callMeta &&
		callMeta.riskClass !== "read"
	) {
		const inferred = inferWriteTarget(
			ctx.domia.id,
			call.name,
			safeArgs,
			ctx.transcript,
			ctx.language,
		)
		if (inferred.kind === "untargeted") {
			ctx.forceNoTool = true
			agentLogger.warn("agent write had no target — asking the user", {
				domiaId: ctx.domia.id,
				name: call.name,
			})
			return {
				kind: "blocked",
				message: MISSING_DETAIL_NUDGE[inferred.missing ?? "target"],
			}
		}
		if (inferred.kind === "inferred") {
			for (const [key, value] of Object.entries(inferred.args)) {
				if (value === undefined) Reflect.deleteProperty(safeArgs, key)
				else safeArgs[key] = value
			}
			call.arguments = safeArgs
			agentLogger.info("agent write target inferred from the utterance", {
				domiaId: ctx.domia.id,
				name: call.name,
				args: inferred.args,
			})
		}
		const described = describeInvocation(
			ctx.domia.id,
			call.name,
			safeArgs,
			ctx.language,
		)
		if (
			!targetMentioned(
				ctx.transcript,
				described,
				ctx.languageSets,
				ctx.opts?.lastActedTarget,
			)
		) {
			ctx.forceNoTool = true
			agentLogger.warn("agent write target not in utterance — blocked", {
				domiaId: ctx.domia.id,
				name: call.name,
				target: described.target,
			})
			return {
				kind: "blocked",
				message: `Blocked: "${described.target ?? advertisedName}" is not what the user asked about. Do not retry — tell the user it couldn't be done.`,
			}
		}
	}
	let needsConfirm = basePolicy === "confirm"
	let resolution: {
		ok: boolean
		resolvedArgs: Record<string, unknown>
	} | null = null
	if (
		ctx.interrogative &&
		!ctx.taintedByOpenWorld &&
		callMeta &&
		callMeta.riskClass !== "read" &&
		ctx.toolNamesUsed.length === 0 &&
		!ctx.readOnlyRetried &&
		ctx.readToolDefs.length > 0
	) {
		ctx.readOnlyRetried = true
		ctx.readOnlyRound = true
		agentLogger.warn("write chosen for a question — retrying read-only", {
			domiaId: ctx.domia.id,
			name: call.name,
		})
		return {
			kind: "read_only_retry",
			message: `That was a question, not a command. Do not change anything: check the current state with a read tool, then answer the user.`,
		}
	} else if (needsConfirm) {
		resolution = await resolveSkillArgs(ctx.domia.id, call.name, safeArgs)
	} else if (
		(ctx.taintedByOpenWorld || ctx.interrogative) &&
		callMeta &&
		callMeta.riskClass !== "read"
	) {
		resolution = await resolveSkillArgs(ctx.domia.id, call.name, safeArgs)
		needsConfirm = true
		agentLogger.warn("write escalated to confirmation", {
			domiaId: ctx.domia.id,
			name: call.name,
			reason: ctx.taintedByOpenWorld ? "open-world taint" : "question",
		})
	} else {
		const resolved = await resolveSkillArgs(ctx.domia.id, call.name, safeArgs)
		if (
			resolved.ok &&
			getInvocationPolicy(ctx.domia.id, call.name, resolved.resolvedArgs)
				.policy === "confirm"
		) {
			resolution = resolved
			needsConfirm = true
		}
	}
	if (needsConfirm) {
		const target: ConfirmTargetType = {
			call,
			confirmArgs: safeArgs,
			resolvedArgs: resolution?.resolvedArgs ?? safeArgs,
			resolutionFailed: resolution ? !resolution.ok : false,
		}
		return { kind: "confirm", target }
	}
	return { kind: "run" }
}

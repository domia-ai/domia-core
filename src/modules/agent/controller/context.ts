import {
	DEFAULT_AGENT_MAX_STEPS,
	DEFAULT_AGENT_BUDGET_MS,
	DEFAULT_LLM_MODEL_CONTEXT_WINDOW,
	DEFAULT_AGENT_REPEAT_WARN_AT,
	DEFAULT_AGENT_REPEAT_BLOCK_AT,
	DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN,
	DEFAULT_AGENT_QUESTION_GUARD_ENABLED,
	DEFAULT_AGENT_TARGET_GUARD_ENABLED,
	DEFAULT_AGENT_READ_THEN_ANSWER_ENABLED,
} from "@/db"
import type { SkillToolType } from "@/db"
import { languageSetsFor } from "@/utils"
import type { DomiaType } from "@/modules/core"
import type { ChatMessageType } from "@/modules/llm-engine"
import { getToolPolicy, getToolMeta } from "@/modules/skill-engine"
import { retryCueHit } from "@/modules/intent-router"
import { createToolGuards, isInterrogative, createToolAliasMap } from "../utils"
import type {
	AgentInferenceType,
	AgentRetryCallType,
	AgentTurnContextType,
	AgentTurnOptionsType,
} from "../types"
import { normalizeToolName, toToolDefs } from "./helpers"
import { buildAgentSystem } from "./prompt"

export const isReadTool = (domiaId: string, name: string): boolean =>
	getToolMeta(domiaId, name)?.riskClass === "read"

export const createTurnContext = (
	domia: DomiaType,
	transcript: string,
	tools: SkillToolType[],
	inference: AgentInferenceType,
	opts?: AgentTurnOptionsType,
): AgentTurnContextType => {
	const advertisedTools =
		opts?.canConfirm === false
			? tools.filter(
					(t) => getToolPolicy(domia.id, t.namespacedName) !== "confirm",
				)
			: tools
	const aliasMap = createToolAliasMap(toToolDefs(advertisedTools))
	const advertisedNames = new Set(aliasMap.aliases)
	const namespacedOf = (emitted: string): string | null => {
		const direct = aliasMap.namespacedOf(emitted)
		if (direct) return direct
		const alias = normalizeToolName(emitted, advertisedNames)
		return alias ? (aliasMap.namespacedOf(alias) ?? null) : null
	}
	const language = domia.characterProfile?.language ?? null
	const system = buildAgentSystem(domia, transcript, opts)
	const retryCall = ((): AgentRetryCallType | null => {
		const candidate = opts?.retryCall
		if (!candidate) return null
		if (!retryCueHit(transcript, language)) return null
		const resolved = namespacedOf(candidate.tool)
		return resolved ? { tool: resolved, args: candidate.args } : null
	})()
	const budgetMs =
		opts?.budgetMs ??
		domia.llmModelConfig?.agentBudgetMs ??
		DEFAULT_AGENT_BUDGET_MS
	const budgetSignals: AbortSignal[] = []
	if (opts?.signal) budgetSignals.push(opts.signal)
	if (budgetMs > 0) budgetSignals.push(AbortSignal.timeout(budgetMs))
	const contextWindow =
		domia.llmModelConfig?.contextWindow ?? DEFAULT_LLM_MODEL_CONTEXT_WINDOW
	const numPredict = Math.max(0, domia.llmModelConfig?.numPredict ?? 0)
	const languageSets = languageSetsFor(language)
	const interrogative =
		(domia.llmModelConfig?.agentQuestionGuardEnabled ??
			DEFAULT_AGENT_QUESTION_GUARD_ENABLED) &&
		isInterrogative(
			transcript,
			languageSets.questionStarters,
			languageSets.requestModals,
		)
	const recentToolsLine = opts?.recentToolsLine
	const userContent =
		recentToolsLine && !interrogative
			? `${transcript}\n[Recently: ${recentToolsLine}]`
			: transcript
	const messages: ChatMessageType[] = [
		{ role: "system", content: system },
		{ role: "user", content: userContent },
	]
	return {
		domia,
		transcript,
		inference,
		opts,
		system,
		language,
		aliasMap,
		namespacedOf,
		toolDefs: aliasMap.toolDefs,
		readToolDefs: aliasMap.toolDefs.filter((t) =>
			isReadTool(domia.id, aliasMap.namespacedOf(t.name) ?? t.name),
		),
		allowedParams: new Map<string, Set<string> | null>(
			advertisedTools.map((t) => {
				const props = t.inputSchema.properties as
					| Record<string, unknown>
					| undefined
				return [
					t.namespacedName,
					props && typeof props === "object"
						? new Set(Object.keys(props))
						: null,
				]
			}),
		),
		requiredParams: new Map<string, string[]>(
			advertisedTools.map((t) => {
				const req = t.inputSchema.required
				return [t.namespacedName, Array.isArray(req) ? req.map(String) : []]
			}),
		),
		toolSchemas: new Map<string, Record<string, unknown>>(
			advertisedTools.map((t) => [t.namespacedName, t.inputSchema]),
		),
		maxSteps: domia.llmModelConfig?.agentMaxSteps ?? DEFAULT_AGENT_MAX_STEPS,
		effectiveSignal:
			budgetSignals.length === 0
				? undefined
				: budgetSignals.length === 1
					? budgetSignals[0]
					: AbortSignal.any(budgetSignals),
		tokenBudget: Math.max(512, contextWindow - numPredict - 256),
		guards: createToolGuards({
			repeatWarnAt:
				domia.llmModelConfig?.agentRepeatWarnAt ?? DEFAULT_AGENT_REPEAT_WARN_AT,
			repeatBlockAt:
				domia.llmModelConfig?.agentRepeatBlockAt ??
				DEFAULT_AGENT_REPEAT_BLOCK_AT,
			maxCallsPerTurn:
				domia.llmModelConfig?.agentMaxToolCallsPerTurn ??
				DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN,
		}),
		interrogative,
		targetGuard:
			domia.llmModelConfig?.agentTargetGuardEnabled ??
			DEFAULT_AGENT_TARGET_GUARD_ENABLED,
		readThenAnswer:
			domia.llmModelConfig?.agentReadThenAnswerEnabled ??
			DEFAULT_AGENT_READ_THEN_ANSWER_ENABLED,
		languageSets,
		retryCall,
		messages,
		toolNamesUsed: [],
		serversUsed: new Set<string>(),
		skillResponses: [],
		idemCache: new Map(),
		argCorrected: new Set<string>(),
		decisionMs: 0,
		toolMs: 0,
		finalizeMs: 0,
		forceNoTool: false,
		taintedByOpenWorld: false,
		readOnlyRound: false,
		readOnlyRetried: false,
	}
}

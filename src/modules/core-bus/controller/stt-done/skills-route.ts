import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import { domiaBusLogger, getTraceContext } from "@/utils"
import type { IntentDecisionType } from "@/modules/intent-router"
import {
	recordLlmUsage,
	hasSkillConnections,
	shortlistedToolsOf,
	originOfInteraction,
	toolManifestOf,
	expectedActionTools,
	namedActionToolsOnly,
} from "../../utils"
import { updateInteraction } from "@/modules/session-manager"
import {
	AGENT_DECISION_MODE_ENUM,
	INTENT_DECISION_ENUM,
	type SkillToolType,
} from "@/db"
import {
	runLLMWithTools,
	runLLMChatConstrainedJson,
	runLLMReplyStreamOrTools,
	runLLMConstrainedJson,
	type LlmUsageType,
} from "@/modules/llm-engine"
import {
	createStructuredInference,
	type AgentInferenceType,
	type AgentStreamInferenceType,
} from "@/modules/agent"
import { classifyNeedsSkill, builtinKeywordHits } from "@/modules/intent-router"
import { getToolMeta } from "@/modules/skill-engine"
import {
	delegateInferenceWithTools,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type {
	CoreBusContextType,
	DelegatedInferenceTurnType,
	SkillIntentVerdictType,
	SttDonePayloadType,
	SttFlowSessionType,
} from "../../types"
import { tryAgentTurn } from "./agent"

const decideSkillIntent = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	tools: SkillToolType[],
	canRunLlm: boolean,
): Promise<SkillIntentVerdictType> => {
	const { domia } = ctx
	const intentStart = Date.now()
	const manifest = toolManifestOf(domia)
	const hints =
		domia.llmModelConfig?.descriptorRoutingEnabled === true
			? {
					exampleUtterances: manifest.exampleUtterances,
					keywords: manifest.keywords,
				}
			: undefined
	const keywordHits = new Set(
		builtinKeywordHits(
			session.transcript,
			domia.characterProfile?.language ?? null,
			Object.values(manifest.builtinToolKeywords).flat(),
		),
	)
	const builtinHit = keywordHits.size > 0
	const routable = tools.filter(
		(t) => !manifest.builtinNames.has(t.namespacedName),
	)
	const decision: IntentDecisionType = builtinHit
		? { needsSkill: true, reason: "builtin-keyword" }
		: routable.length === 0
			? { needsSkill: false, reason: "no-routable-tools" }
			: await classifyNeedsSkill(
					domia,
					session.transcript,
					routable.map((t) => ({
						name: t.rawName,
						description: t.description,
					})),
					{ canRunLlm, hints },
				)
	const intentDecision = `${decision.needsSkill ? INTENT_DECISION_ENUM.SKILL : INTENT_DECISION_ENUM.CHAT} (${decision.reason})`
	const intentMs = Date.now() - intentStart
	domiaBusLogger.info(`🧭 intent: ${intentDecision} ${intentMs}ms`, {
		domiaId: domia.id,
	})
	void updateInteraction({
		id: session.interactionId,
		intentDecision,
		intentMs,
	}).catch((err: unknown) =>
		domiaBusLogger.warn("skills-route: intent persist failed", {
			interactionId: session.interactionId,
			err,
		}),
	)
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.INTENT_DECIDED,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey ?? "",
		traceId: getTraceContext()?.traceId,
		decision: intentDecision,
		intentMs,
	})
	const isReadTool = (name: string): boolean =>
		getToolMeta(domia.id, name)?.riskClass === "read"
	const expectedTools = expectedActionTools(
		tools,
		manifest.builtinToolKeywords,
		keywordHits,
		isReadTool,
	)
	return {
		decision,
		expectedTools,
		tools: namedActionToolsOnly(
			tools,
			manifest.builtinToolKeywords,
			expectedTools,
			isReadTool,
		),
	}
}

export const delegatedAgentInference =
	(
		senderDomiaKey: string,
		target: DeliverEventTarget,
		turn: DelegatedInferenceTurnType,
	): AgentInferenceType =>
	(messages, toolDefs, toolChoice, signal) =>
		delegateInferenceWithTools(senderDomiaKey, target, {
			messages,
			tools: toolDefs,
			toolChoice,
			signal,
			originDomiaKey: turn.originDomiaKey,
			interactionId: turn.interactionId,
		})

export const attemptLocalSkillsRoute = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	payload: SttDonePayloadType,
	turnSignal: AbortSignal | undefined,
): Promise<boolean> => {
	const { domia, features } = ctx
	if (!hasSkillConnections(ctx.domia)) return false
	if (payload.prestartedTokens) {
		const stale = payload.prestartedTokens as AsyncGenerator<string>
		domiaBusLogger.info(
			"🔮 skills route with prestarted stream — cancelling stale speculation",
			{ domiaId: domia.id, interactionId: session.interactionId },
		)
		void stale.return(undefined).catch(() => undefined)
		payload.prestartedTokens = undefined
		payload.prestartedFirstUnitText = undefined
		payload.prestartedFirstUnitPcm = undefined
	}
	const tools = await shortlistedToolsOf(
		domia,
		session.transcript,
		originOfInteraction(ctx, session.interactionId),
	)
	if (tools.length === 0 || !features.llm?.adapter.runWithTools) return false
	const {
		decision,
		expectedTools,
		tools: offered,
	} = await decideSkillIntent(ctx, session, tools, true)
	if (!decision.needsSkill) return false
	payload.eagerPrefill?.cancel("skills route — tools only after final")
	const onUsage = (u: LlmUsageType) => recordLlmUsage(session.interactionId, u)
	const structuredMode =
		domia.llmModelConfig?.agentDecisionMode ===
		AGENT_DECISION_MODE_ENUM.STRUCTURED
	const inference: AgentInferenceType = structuredMode
		? createStructuredInference(domia, (messages, schema, signal) =>
				runLLMChatConstrainedJson(domia, messages, schema, onUsage, signal),
			)
		: (messages, toolDefs, toolChoice, signal) =>
				runLLMWithTools(domia, messages, toolDefs, onUsage, toolChoice, signal)
	const streamFinalize: AgentStreamInferenceType | undefined =
		features.canSentencePipeline && !structuredMode
			? (messages, toolDefs, toolChoice, signal) =>
					runLLMReplyStreamOrTools(
						domia,
						messages,
						toolDefs,
						onUsage,
						toolChoice,
						signal,
					)
			: undefined
	return tryAgentTurn(
		ctx,
		session,
		offered,
		inference,
		{
			key: domia.domiaKey,
			model: domia.llmModelConfig?.modelName ?? null,
		},
		streamFinalize,
		turnSignal,
		(prompt, schema) => runLLMConstrainedJson(domia, prompt, schema),
		expectedTools,
	)
}

export const attemptDelegatedSkillsRoute = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
	turnSignal: AbortSignal | undefined,
): Promise<boolean> => {
	const { domia } = ctx
	if (!hasSkillConnections(ctx.domia)) return false
	const tools = await shortlistedToolsOf(
		domia,
		session.transcript,
		originOfInteraction(ctx, session.interactionId),
	)
	if (tools.length === 0) return false
	const {
		decision,
		expectedTools,
		tools: offered,
	} = await decideSkillIntent(ctx, session, tools, false)
	if (!decision.needsSkill) return false
	const target = targets[0]
	domiaBusLogger.info("🛰️ delegating agent inference to peer", {
		target: target.domiaKey,
		tools: offered.length,
	})
	return tryAgentTurn(
		ctx,
		session,
		offered,
		delegatedAgentInference(domia.domiaKey, target, {
			originDomiaKey: session.originDomiaKey ?? domia.domiaKey,
			interactionId: session.interactionId,
		}),
		{
			key: target.domiaKey,
			model: null,
		},
		undefined,
		turnSignal,
		undefined,
		expectedTools,
	)
}

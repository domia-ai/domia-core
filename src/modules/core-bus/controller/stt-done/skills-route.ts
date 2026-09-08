import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import { domiaBusLogger, getTraceContext } from "@/utils"
import { recordLlmUsage, skillsEnabled, shortlistedToolsOf } from "../../utils"
import { updateInteraction } from "@/modules/session-manager"
import { AGENT_DECISION_MODE_ENUM } from "@/db"
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
import { classifyNeedsSkill } from "@/modules/intent-router"
import { buildToolManifest } from "@/modules/skill-engine"
import {
	delegateInferenceWithTools,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type {
	CoreBusContextType,
	SttDonePayloadType,
	SttFlowSessionType,
} from "../../types"
import { tryAgentTurn } from "./agent"

export const attemptLocalSkillsRoute = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	payload: SttDonePayloadType,
	turnSignal: AbortSignal | undefined,
): Promise<boolean> => {
	const { domia, features } = ctx
	if (!skillsEnabled(ctx)) return false
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
	const tools = await shortlistedToolsOf(domia, session.transcript)
	if (tools.length === 0 || !features.llm?.adapter.runWithTools) return false
	const intentStart = Date.now()
	const hints =
		domia.llmModelConfig?.descriptorRoutingEnabled === true
			? (() => {
					const manifest = buildToolManifest(domia)
					return {
						exampleUtterances: manifest.exampleUtterances,
						keywords: manifest.keywords,
					}
				})()
			: undefined
	const decision = await classifyNeedsSkill(
		domia,
		session.transcript,
		tools.map((t) => ({
			name: t.rawName,
			description: t.description,
		})),
		{ canRunLlm: true, hints },
	)
	const intentDecision = `${decision.needsSkill ? "skill" : "chat"} (${decision.reason})`
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
		tools,
		inference,
		{
			key: domia.domiaKey,
			model: domia.llmModelConfig?.modelName ?? null,
		},
		streamFinalize,
		turnSignal,
		(prompt, schema) => runLLMConstrainedJson(domia, prompt, schema),
	)
}

export const attemptDelegatedSkillsRoute = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
	turnSignal: AbortSignal | undefined,
): Promise<boolean> => {
	const { domia } = ctx
	if (!skillsEnabled(ctx)) return false
	const tools = await shortlistedToolsOf(domia, session.transcript)
	if (tools.length === 0) return false
	const target = targets[0]
	domiaBusLogger.info("🛰️ delegating agent inference to peer", {
		target: target.domiaKey,
		tools: tools.length,
	})
	const inference: AgentInferenceType = (messages, toolDefs) =>
		delegateInferenceWithTools(domia.domiaKey, target, {
			messages,
			tools: toolDefs,
			originDomiaKey: session.originDomiaKey ?? domia.domiaKey,
			interactionId: session.interactionId,
		})
	return tryAgentTurn(
		ctx,
		session,
		tools,
		inference,
		{
			key: target.domiaKey,
			model: null,
		},
		undefined,
		turnSignal,
	)
}

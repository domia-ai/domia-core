import {
	emitTurnEvent,
	publishToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	DOMIA_TURN_EVENT_ENUM,
} from "@/buses"
import { domiaBusLogger, getTraceContext, languageSetsFor } from "@/utils"
import type { IntentDecisionType } from "@/modules/intent-router"
import {
	recordLlmUsage,
	hasSkillConnections,
	shortlistedToolsOf,
	originOfInteraction,
	toolManifestOf,
	getInteractionRuntime,
	lastToolCall,
	takeOpenRequest,
	expectedActionTools,
	judgeableToolsOf,
	judgeCatalogOf,
	isReadTool,
	offerableToolsOf,
	providerReadToolsOf,
	withJudgedTool,
	namedToolsOnly,
} from "../../utils"
import { updateInteraction } from "@/modules/session-manager"
import {
	AGENT_DECISION_MODE_ENUM,
	DEFAULT_AGENT_QUESTION_GUARD_ENABLED,
	INTENT_DECISION_ENUM,
	SKILLS_ROUTING_ENUM,
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
	confirmationScope,
	createStructuredInference,
	isInterrogative,
	type AgentInferenceType,
	type AgentStreamInferenceType,
} from "@/modules/agent"
import {
	numericFollowUp,
	requestedToolOf,
	retryCueHit,
	routingBlockerHit,
	type ToolJudgeRemoteType,
} from "@/modules/intent-router"
import { knownSlotCount } from "@/modules/llm-slots"
import {
	delegateInferenceWithTools,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type { DomiaType } from "@/modules/core"
import type {
	CoreBusContextType,
	DelegatedInferenceTurnType,
	JudgedDecisionType,
	SkillIntentVerdictType,
	SttDonePayloadType,
	SttFlowSessionType,
} from "../../types"
import { tryAgentTurn } from "./agent"

const isQuestion = (ctx: CoreBusContextType, utterance: string): boolean => {
	const sets = languageSetsFor(ctx.domia.characterProfile?.language ?? null)
	return (
		(ctx.domia.llmModelConfig?.agentQuestionGuardEnabled ??
			DEFAULT_AGENT_QUESTION_GUARD_ENABLED) &&
		isInterrogative(utterance, sets.questionStarters, sets.requestModals)
	)
}

const followUpDecision = async (
	ctx: CoreBusContextType,
	utterance: string,
): Promise<IntentDecisionType | null> => {
	const language = ctx.domia.characterProfile?.language
	const retry = retryCueHit(utterance, language)
	const numeric = !retry && numericFollowUp(utterance, language)
	if (!retry && !numeric) return null
	const recent = await lastToolCall(ctx.domia).catch(() => null)
	if (recent === null)
		return retry ? { needsSkill: false, reason: "nothing-to-retry" } : null
	return retry
		? { needsSkill: true, reason: `retry:${retry}` }
		: { needsSkill: true, reason: "numeric-followup" }
}

const judgedDecision = async (
	ctx: CoreBusContextType,
	canRunLlm: boolean,
	utterance: string,
	clarified: boolean,
	remoteJudge: ToolJudgeRemoteType | undefined,
): Promise<JudgedDecisionType> => {
	const { domia } = ctx
	if (domia.llmModelConfig?.skillsRouting === SKILLS_ROUTING_ENUM.ALWAYS_AGENT)
		return {
			decision: { needsSkill: true, reason: "always-agent" },
			judged: null,
		}
	if (clarified)
		return { decision: { needsSkill: true, reason: "clarified" }, judged: null }
	const followUp = await followUpDecision(ctx, utterance)
	if (followUp) return { decision: followUp, judged: null }
	const catalog = judgeCatalogOf(
		judgeableToolsOf(domia),
		toolManifestOf(domia).toolExamples,
		toolManifestOf(domia).toolLabels,
	)
	const verdict =
		canRunLlm || remoteJudge
			? await requestedToolOf(domia, utterance, catalog.hints, remoteJudge)
			: { tool: null, failed: true }
	const judged =
		verdict.tool === null ? null : (catalog.byName.get(verdict.tool) ?? null)
	return judged
		? {
				decision: { needsSkill: true, reason: `judge:${judged.rawName}` },
				judged,
			}
		: {
				decision: {
					needsSkill: false,
					reason: verdict.failed ? "judge:failed" : "judge:none",
				},
				judged: null,
			}
}

const decideSkillIntent = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	tools: SkillToolType[],
	canRunLlm: boolean,
	utterance: string,
	clarified: boolean,
	remoteJudge?: ToolJudgeRemoteType,
): Promise<SkillIntentVerdictType> => {
	const { domia } = ctx
	const intentStart = Date.now()
	const { decision: routed, judged } = await judgedDecision(
		ctx,
		canRunLlm,
		utterance,
		clarified,
		remoteJudge,
	)
	const origin = originOfInteraction(ctx, session.interactionId)
	const writes = judged !== null && !isReadTool(domia, judged.namespacedName)
	const negated = writes
		? routingBlockerHit(utterance, domia.characterProfile?.language)
		: null
	const questioned =
		writes && !negated && isQuestion(ctx, utterance) ? judged : null
	const readInstead = questioned
		? providerReadToolsOf(
				domia,
				offerableToolsOf(domia, origin),
				questioned.namespacedName,
			)
		: []
	const decision: IntentDecisionType = negated
		? { needsSkill: false, reason: `negated:${negated}` }
		: questioned && readInstead.length === 0
			? { needsSkill: false, reason: `question:${questioned.rawName}` }
			: routed
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
	if (negated || questioned)
		return {
			decision,
			expectedTools: [],
			tools: readInstead,
			namedToolUnavailable: false,
		}
	const named =
		judged && !isReadTool(domia, judged.namespacedName)
			? [judged.namespacedName]
			: []
	const candidates = withJudgedTool(domia, tools, judged, origin)
	const expectedTools = expectedActionTools(candidates, named)
	return {
		decision,
		expectedTools,
		tools: namedToolsOnly(candidates, judged ? [judged.namespacedName] : []),
		namedToolUnavailable: named.length > 0 && expectedTools.length === 0,
	}
}

const replyNamedToolUnavailable = (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): boolean => {
	const { domia } = ctx
	const reply = languageSetsFor(domia.characterProfile?.language ?? null)
		.phrases.cantDoThat
	domiaBusLogger.info("🧰 the tool the words name is unavailable here", {
		domiaId: domia.id,
		interactionId: session.interactionId,
	})
	void updateInteraction({
		id: session.interactionId,
		llmResponse: reply,
	}).catch((err: unknown) =>
		domiaBusLogger.warn("detached updateInteraction failed", { err }),
	)
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey ?? domia.domiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
	})
	return true
}

const turnScopeOf = (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): string => {
	const envelope = getInteractionRuntime(session.interactionId)?.envelope
	return confirmationScope(
		ctx.domia.domiaKey,
		envelope?.satelliteId ?? envelope?.source,
	)
}

const utteranceOf = (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
): { utterance: string; clarified: boolean } => {
	const open = takeOpenRequest(turnScopeOf(ctx, session), session.transcript)
	return open
		? {
				utterance: `${open.transcript} ${session.transcript}`,
				clarified: true,
			}
		: { utterance: session.transcript, clarified: false }
}

export const delegatedToolJudge =
	(
		senderDomiaKey: string,
		target: DeliverEventTarget,
		turn: DelegatedInferenceTurnType,
	): ToolJudgeRemoteType =>
	async (request) => {
		const out = await delegateInferenceWithTools(senderDomiaKey, target, {
			messages: [
				{ role: "system", content: request.system },
				{ role: "user", content: request.user },
			],
			tools: [],
			toolChoice: "none",
			choice: request,
			originDomiaKey: turn.originDomiaKey,
			interactionId: turn.interactionId,
		})
		return out.kind === "reply" ? out.text : null
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

const cancelPrestarted = (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	payload: SttDonePayloadType,
): void => {
	if (!payload.prestartedTokens) return
	const stale = payload.prestartedTokens as AsyncGenerator<string>
	domiaBusLogger.info(
		"🔮 skills route with prestarted stream — cancelling stale speculation",
		{ domiaId: ctx.domia.id, interactionId: session.interactionId },
	)
	void stale.return(undefined).catch(() => undefined)
	payload.prestartedTokens = undefined
	payload.prestartedFirstUnitText = undefined
	payload.prestartedFirstUnitPcm = undefined
}

const judgeCanRunBesideSpeculation = (domia: DomiaType): boolean =>
	(knownSlotCount(domia) ?? 1) >= 2

export const attemptLocalSkillsRoute = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	payload: SttDonePayloadType,
	turnSignal: AbortSignal | undefined,
): Promise<boolean> => {
	const { domia, features } = ctx
	if (!hasSkillConnections(ctx.domia)) return false
	if (!judgeCanRunBesideSpeculation(domia))
		cancelPrestarted(ctx, session, payload)
	const { utterance, clarified } = utteranceOf(ctx, session)
	const tools = await shortlistedToolsOf(
		domia,
		utterance,
		originOfInteraction(ctx, session.interactionId),
	)
	if (tools.length === 0 || !features.llm?.adapter.runWithTools) return false
	const {
		decision,
		expectedTools,
		tools: offered,
		namedToolUnavailable,
	} = await decideSkillIntent(ctx, session, tools, true, utterance, clarified)
	if (!decision.needsSkill) return false
	cancelPrestarted(ctx, session, payload)
	if (namedToolUnavailable) return replyNamedToolUnavailable(ctx, session)
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
		utterance,
	)
}

export const attemptDelegatedSkillsRoute = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	targets: DeliverEventTarget[],
	turnSignal: AbortSignal | undefined,
	payload?: SttDonePayloadType,
): Promise<boolean> => {
	const { domia } = ctx
	if (!hasSkillConnections(ctx.domia)) return false
	const { utterance, clarified } = utteranceOf(ctx, session)
	const tools = await shortlistedToolsOf(
		domia,
		utterance,
		originOfInteraction(ctx, session.interactionId),
	)
	if (tools.length === 0) return false
	const {
		decision,
		expectedTools,
		tools: offered,
		namedToolUnavailable,
	} = await decideSkillIntent(
		ctx,
		session,
		tools,
		false,
		utterance,
		clarified,
		delegatedToolJudge(domia.domiaKey, targets[0], {
			originDomiaKey: session.originDomiaKey ?? domia.domiaKey,
			interactionId: session.interactionId,
		}),
	)
	if (!decision.needsSkill) return false
	if (payload) cancelPrestarted(ctx, session, payload)
	if (namedToolUnavailable) return replyNamedToolUnavailable(ctx, session)
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
		utterance,
	)
}

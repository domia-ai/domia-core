import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import { domiaBusLogger, getTraceContext, toError } from "@/utils"
import {
	ensureReplyOrFallback,
	notifyInteractionFailed,
	isTurnAborted,
	takeLlmUsage,
	usageCols,
	takeReplyQueueWait,
	resourceCols,
	speak,
	isRecordingInProgress,
	getInteractionRuntime,
	stage,
	getActiveTurn,
	recentToolsLine,
	lastActedEntity,
	lastToolCall,
} from "../../utils"
import { updateInteraction, pipelineElapsed } from "@/modules/session-manager"
import {
	DEFAULT_ASYNC_FOLLOW_UP_POLICY,
	DEFAULT_ASYNC_FOLLOW_UP_MAX_WAIT_MS,
	DEFAULT_QUIET_AUDIO_POLL_MS,
	DEFAULT_QUIET_AUDIO_DEADLINE_MS,
	type SkillToolType,
	type ToolTraceEntryType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { reflectOnInteraction } from "@/modules/reflection"
import { playFeedbackSound } from "@/modules/feedback-sounds"
import {
	runAgentTurn,
	type AgentInferenceType,
	type AgentStreamInferenceType,
	type AgentResultType,
} from "@/modules/agent"
import { deliverReply } from "../llm-done"
import {
	claimToolRunSpoken,
	unclaimToolRunSpoken,
} from "@/modules/skill-engine"
import { hasActivePlayback } from "@/modules/audio-playback"
import type { CoreBusContextType, SttFlowSessionType } from "../../types"
import { persistTurnComplete, finalizeExpressedEmotion } from "./persist"
import { pipelineVoiceFromTokens } from "./pipeline"

const quietAudioPollMs = (domia: DomiaType): number =>
	domia.llmModelConfig?.quietAudioPollMs ?? DEFAULT_QUIET_AUDIO_POLL_MS

const waitForQuietAudio = async (domia: DomiaType): Promise<boolean> => {
	const t0 = Date.now()
	const deadlineMs =
		domia.llmModelConfig?.quietAudioDeadlineMs ??
		DEFAULT_QUIET_AUDIO_DEADLINE_MS
	const pollMs = quietAudioPollMs(domia)
	while (hasActivePlayback(domia.id) || isRecordingInProgress(domia.id)) {
		if (Date.now() - t0 > deadlineMs) return false
		await new Promise((resolve) => setTimeout(resolve, pollMs))
	}
	return true
}

const waitForTurnIdle = async (
	domia: DomiaType,
	ownInteractionId: string,
): Promise<boolean> => {
	const policy =
		domia.llmModelConfig?.asyncFollowUpPolicy ?? DEFAULT_ASYNC_FOLLOW_UP_POLICY
	const deadlineMs =
		domia.llmModelConfig?.asyncFollowUpMaxWaitMs ??
		DEFAULT_ASYNC_FOLLOW_UP_MAX_WAIT_MS
	const busy = (): boolean => {
		const live = getActiveTurn(domia.id)
		return live !== null && live.interactionId !== ownInteractionId
	}
	if (!busy()) return true
	if (policy === "drop") return false
	const t0 = Date.now()
	const pollMs = quietAudioPollMs(domia)
	while (busy()) {
		if (Date.now() - t0 > deadlineMs) return false
		await new Promise((resolve) => setTimeout(resolve, pollMs))
	}
	return true
}

const withAgentSummary = (result: AgentResultType): ToolTraceEntryType[] => [
	...result.skillResponses,
	{
		kind: "summary",
		decisionMs: result.decisionMs,
		toolMs: result.toolMs,
		finalizeMs: result.finalizeMs,
		finalizeMode: result.finalizeMode,
		stopReason: result.stopReason,
	},
]

const agentTimingCols = (
	result: AgentResultType,
): {
	agentDecisionMs: number | null
	agentToolMs: number | null
	agentFinalizeMs: number | null
} => ({
	agentDecisionMs: result.decisionMs,
	agentToolMs: result.toolMs,
	agentFinalizeMs: result.finalizeMs,
})

const toolCols = (
	result: AgentResultType,
): { toolCallCount: number | null; toolErrorCount: number | null } => {
	const calls = result.toolNamesUsed.length
	if (calls === 0) return { toolCallCount: null, toolErrorCount: null }
	const errors = result.skillResponses.filter(
		(r) =>
			(r.kind === "result" || r.kind === "async_outcome") &&
			r.status !== "ok" &&
			r.status !== "cancelled",
	).length
	return { toolCallCount: calls, toolErrorCount: errors }
}

export const tryAgentTurn = async (
	ctx: CoreBusContextType,
	session: SttFlowSessionType,
	tools: SkillToolType[],
	inference: AgentInferenceType,
	executor: { key: string; model: string | null },
	streamFinalize?: AgentStreamInferenceType,
	signal?: AbortSignal,
	constrainedRepair?: (
		prompt: string,
		schema: Record<string, unknown>,
	) => Promise<string | null>,
): Promise<boolean> => {
	const { domia } = ctx
	const envelope = getInteractionRuntime(session.interactionId)?.envelope
	const confirmationChannel = envelope?.satelliteId ?? envelope?.source
	const [toolsLine, actedTarget, retryCall] = await Promise.all([
		recentToolsLine(domia).catch(() => null),
		lastActedEntity(domia).catch(() => null),
		lastToolCall(domia).catch(() => null),
	])
	let result: AgentResultType
	try {
		result = await stage(
			{
				interactionId: session.interactionId,
				originDomiaKey: session.originDomiaKey ?? domia.domiaKey,
				satelliteId: envelope?.satelliteId,
				traceId: getTraceContext()?.traceId,
			},
			"skills",
			() =>
				runAgentTurn(domia, session.transcript, tools, inference, {
					voice: session.isVoice,
					streamFinalize,
					allowAsyncTools: session.isVoice && session.liveVoice === true,
					signal,
					confirmationChannel,
					recentToolsLine: toolsLine ?? undefined,
					lastActedTarget: actedTarget?.entity,
					retryCall: retryCall ?? undefined,
					knownFacts: session.knownFacts,
					knowledgeBase: session.knowledgeBase,
					constrainedRepair,
					onSlowTool:
						session.isVoice && session.liveVoice
							? () => playFeedbackSound(domia, "thinking")
							: undefined,
				}),
		)
	} catch (err) {
		domiaBusLogger.warn("agent turn failed — falling through to normal LLM", {
			domiaId: domia.id,
			interactionId: session.interactionId,
			err,
		})
		return false
	}

	if (result.pendingTools?.length) {
		const pending = result.pendingTools
		const asyncTraceId = getTraceContext()?.traceId
		void Promise.allSettled(pending).then(async (settled) => {
			const outcomes = settled
				.map((s) => (s.status === "fulfilled" ? s.value : null))
				.filter((o): o is NonNullable<typeof o> => o !== null)
			const failures = outcomes.filter((o) => !o.ok)
			const followUp =
				failures.length > 0
					? [...new Set(failures.map((o) => o.doneText))].join(" ")
					: [...new Set(outcomes.map((o) => o.doneText))].join(" ")
			domiaBusLogger.info(
				`🧰 async tools settled (${outcomes.length}) → "${followUp}"`,
				{ domiaId: domia.id, interactionId: session.interactionId },
			)
			const outcomeEntries: ToolTraceEntryType[] = outcomes.map((o) => ({
				kind: "async_outcome",
				tool: o.tool,
				status: o.ok ? "ok" : "failed",
				summaryForLlm: o.doneText,
				resolvedArgs: o.resolvedArgs,
			}))
			for (const o of outcomes) {
				emitTurnEvent({
					type: DOMIA_TURN_EVENT_ENUM.TOOL_RESULT,
					interactionId: session.interactionId,
					originDomiaKey: session.originDomiaKey ?? "",
					traceId: asyncTraceId,
					toolName: o.tool,
					status: o.ok ? "ok" : "failed",
				})
			}
			const settledResult = {
				...result,
				skillResponses: [...result.skillResponses, ...outcomeEntries],
			}
			void updateInteraction({
				id: session.interactionId,
				skillResponse: withAgentSummary(settledResult),
				toolErrorCount:
					failures.length > 0
						? failures.length
						: (toolCols(result).toolErrorCount ?? null),
			}).catch((err: unknown) =>
				domiaBusLogger.warn("async-tool outcome persist failed", {
					interactionId: session.interactionId,
					err,
				}),
			)
			if (!followUp) return
			if (isTurnAborted(domia.id, session.interactionId)) {
				domiaBusLogger.info("async tool follow-up dropped — turn superseded", {
					domiaId: domia.id,
					interactionId: session.interactionId,
				})
				return
			}
			const quiet = await waitForQuietAudio(domia)
			if (!quiet) {
				domiaBusLogger.warn(
					"async tool follow-up dropped — audio busy past deadline",
					{ domiaId: domia.id, interactionId: session.interactionId },
				)
				return
			}
			const idle = await waitForTurnIdle(domia, session.interactionId)
			if (!idle) {
				domiaBusLogger.info(
					"async tool follow-up dropped — a newer turn is live",
					{ domiaId: domia.id, interactionId: session.interactionId },
				)
				return
			}
			if (isTurnAborted(domia.id, session.interactionId)) {
				domiaBusLogger.info("async tool follow-up dropped — turn superseded", {
					domiaId: domia.id,
					interactionId: session.interactionId,
				})
				return
			}
			const speakable = outcomes.filter((o) =>
				claimToolRunSpoken(session.interactionId, o.tool, o.resolvedArgs),
			)
			if (speakable.length === 0) {
				domiaBusLogger.info("async tool follow-up already spoken — skipped", {
					domiaId: domia.id,
					interactionId: session.interactionId,
				})
				return
			}
			const speakableFailures = speakable.filter((o) => !o.ok)
			const spokenText = [
				...new Set(
					(speakableFailures.length > 0 ? speakableFailures : speakable).map(
						(o) => o.doneText,
					),
				),
			].join(" ")
			void speak(domia, spokenText).catch((err: unknown) => {
				domiaBusLogger.warn("async tool follow-up speak failed — unclaiming", {
					domiaId: domia.id,
					err,
				})
				for (const o of speakable)
					unclaimToolRunSpoken(session.interactionId, o.tool, o.resolvedArgs)
			})
		})
	}

	if (result.replyStream && session.isVoice) {
		try {
			await updateInteraction({
				id: session.interactionId,
				skillProviderUsed: result.serversUsed.join(",") || null,
				skillPrompt: result.skillPrompt,
				skillResponse: withAgentSummary(result),
				...agentTimingCols(result),
				...toolCols(result),
			})
			const piped = await pipelineVoiceFromTokens(
				ctx,
				session,
				result.replyStream,
				{
					llmExecutorKey: executor.key,
					llmModelUsed: executor.model,
				},
			)
			if (!piped) result.replyStreamClose?.()
			return piped
		} catch (err) {
			result.replyStreamClose?.()
			throw err
		}
	}

	if (result.replyStream) result.replyStreamClose?.()

	const { reply: agentReply } = ensureReplyOrFallback(
		result.reply,
		domia.characterProfile?.language,
	)
	const reply = finalizeExpressedEmotion(domia, agentReply)

	await persistTurnComplete(
		{
			id: session.interactionId,
			llmPrompt: session.promptContext,
			llmResponse: reply,
			llmExecutorKey: executor.key,
			llmMs: result.finalizeMs,
			llmModelUsed: executor.model,
			skillProviderUsed: result.serversUsed.join(",") || null,
			skillPrompt: result.skillPrompt,
			skillResponse: withAgentSummary(result),
			...agentTimingCols(result),
			...toolCols(result),
			...usageCols(takeLlmUsage(session.interactionId)),
			...resourceCols(domia),
			llmQueueMs: takeReplyQueueWait(session.interactionId),
			totalMs: pipelineElapsed(session.interactionId),
		},
		!session.isVoice,
	)

	void deliverReply(ctx, {
		reply,
		transcript: session.transcript,
		interactionId: session.interactionId,
		originDomiaKey: session.originDomiaKey,
		responseType: session.responseType,
		speechEndAt: session.speechEndAt,
		liveVoice: session.liveVoice,
	}).catch((err: unknown) => {
		domiaBusLogger.error("agent turn deliverReply failed", {
			domiaId: domia.id,
			interactionId: session.interactionId,
			err,
		})
		notifyInteractionFailed(ctx, {
			interactionId: session.interactionId,
			originDomiaKey: session.originDomiaKey,
			responseType: session.responseType,
			error: toError(err),
			step: "delivery",
			liveVoice: session.liveVoice,
		})
	})

	if (!session.isVoice) {
		await updateInteraction({ id: session.interactionId, heardReply: reply })
		void reflectOnInteraction(
			domia,
			session.transcript,
			reply,
			session.interactionId,
			session.originDomiaKey,
		)
	}
	return true
}

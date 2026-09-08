import {
	publishToDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	emitTurnEvent,
	DOMIA_TURN_EVENT_ENUM,
} from "@/buses"
import { domiaBusLogger, getTraceContext, languageSetsFor } from "@/utils"
import {
	getInteractionRuntime,
	peekPendingElicit,
	takePendingElicit,
	elicitContentFor,
} from "../../utils"
import { updateInteraction } from "@/modules/session-manager"
import { SKILL_TOOL_NAME_SEPARATOR, type ToolTraceEntryType } from "@/db"
import {
	peekPendingConfirmation,
	peekExpiredConfirmation,
	takePendingConfirmation,
	settleConfirmation,
	claimConfirmation,
	markConfirmationReasked,
	confirmationScope,
	isAffirmative,
	isNegative,
} from "@/modules/agent"
import {
	callTool,
	resolveToolFinalize,
	renderFinalizeText,
} from "@/modules/skill-engine"
import type { CoreBusContextType, SttDonePayloadType } from "../../types"

export const handlePendingConfirmation = async (
	ctx: CoreBusContextType,
	payload: SttDonePayloadType,
	interactionId: string,
	transcript: string,
	originDomiaKey: string,
): Promise<boolean> => {
	const { domia } = ctx
	const domiaId = domia.id
	const envelope = getInteractionRuntime(interactionId)?.envelope
	const confirmScope = confirmationScope(
		domia.domiaKey,
		envelope?.satelliteId ?? envelope?.source,
	)
	const elicitEntry = peekPendingElicit(confirmScope)
		? takePendingElicit(confirmScope)
		: null
	if (elicitEntry) {
		const elicitAffirmative = isAffirmative(transcript, elicitEntry.language)
		const elicitNegative = isNegative(transcript, elicitEntry.language)
		const elicitContent =
			elicitNegative && !elicitAffirmative
				? null
				: elicitContentFor(
						elicitEntry.requestedSchema,
						transcript,
						elicitAffirmative,
						elicitNegative,
					)
		if (elicitContent === null) elicitEntry.resolve({ action: "decline" })
		else elicitEntry.resolve({ action: "accept", content: elicitContent })
		domiaBusLogger.info(
			`🛎️ elicitation answered: "${transcript.slice(0, 60)}"`,
			{ domiaId, interactionId },
		)
		void updateInteraction({
			id: interactionId,
			intentDecision: "elicit-answer",
		}).catch((err: unknown) =>
			domiaBusLogger.warn("confirmation: elicit-answer persist failed", {
				interactionId,
				err,
			}),
		)
		return true
	}
	const pending = peekPendingConfirmation(confirmScope)
	if (!pending) {
		const expired = peekExpiredConfirmation(confirmScope)
		if (expired && isAffirmative(transcript, expired.language)) {
			settleConfirmation(confirmScope, "expired")
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
				reply: languageSetsFor(expired.language).phrases.confirmExpired,
				transcript,
				interactionId,
				originDomiaKey,
				responseType: payload.responseType,
				speechEndAt: payload.speechEndAt,
				liveVoice: payload.liveVoice,
			})
			return true
		}
	}
	if (pending) {
		const phrases = languageSetsFor(pending.language).phrases
		const replyConfirm = (reply: string): void =>
			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
				reply,
				transcript,
				interactionId,
				originDomiaKey,
				responseType: payload.responseType,
				speechEndAt: payload.speechEndAt,
				liveVoice: payload.liveVoice,
			})
		const affirmative = isAffirmative(transcript, pending.language)
		const negative = isNegative(transcript, pending.language)
		const taken =
			affirmative !== negative ? takePendingConfirmation(confirmScope) : null
		const claimed = taken
			? claimConfirmation(confirmScope, affirmative ? "approved" : "denied")
			: false
		if (taken && !claimed) {
			domiaBusLogger.warn(
				"confirmation claim lost — not executing (already settled or persist failed)",
				{ domiaId, interactionId, tool: taken.tool },
			)
			replyConfirm(phrases.confirmExpired)
			return true
		}
		if (taken && affirmative) {
			emitTurnEvent({
				type: DOMIA_TURN_EVENT_ENUM.TOOL_REQUESTED,
				interactionId,
				originDomiaKey,
				traceId: getTraceContext()?.traceId,
				toolName: taken.tool,
			})
			let reply: string
			let trace: Extract<ToolTraceEntryType, { kind: "result" }>
			const toolStart = Date.now()
			try {
				const res = taken.resolvedArgs
					? await callTool(
							domia.id,
							taken.tool,
							taken.resolvedArgs,
							undefined,
							true,
						)
					: await callTool(domia.id, taken.tool, taken.args)
				const ok = res.status === "ok" && !res.isError
				const rule = resolveToolFinalize(domia.id, taken.tool)
				const template = ok ? rule?.done : rule?.error
				const fallback = ok ? phrases.thatIsDone : phrases.cantDoThat
				reply = template
					? (renderFinalizeText(template, taken.args, res.resolvedArgs) ??
						fallback)
					: fallback
				trace = {
					kind: "result",
					tool: taken.tool,
					status: ok ? "ok" : "failed",
					durationMs: Date.now() - toolStart,
					summaryForLlm: res.text,
					args: taken.args,
					resolvedArgs: res.resolvedArgs,
				}
			} catch (err) {
				domiaBusLogger.warn("confirmed action failed", {
					domiaId,
					interactionId,
					err,
				})
				reply = phrases.cantDoThat
				trace = {
					kind: "result",
					tool: taken.tool,
					status: "failed",
					durationMs: Date.now() - toolStart,
					summaryForLlm: String(err),
					args: taken.args,
				}
			}
			emitTurnEvent({
				type: DOMIA_TURN_EVENT_ENUM.TOOL_RESULT,
				interactionId,
				originDomiaKey,
				traceId: getTraceContext()?.traceId,
				toolName: taken.tool,
				status: trace.status,
				toolMs: Date.now() - toolStart,
			})
			void updateInteraction({
				id: interactionId,
				skillProviderUsed:
					taken.tool.split(SKILL_TOOL_NAME_SEPARATOR)[0] ?? null,
				skillResponse: [trace],
				toolCallCount: 1,
			}).catch((err: unknown) =>
				domiaBusLogger.warn("confirmation: confirmed-tool persist failed", {
					interactionId,
					err,
				}),
			)
			replyConfirm(reply)
			return true
		}
		if (taken && negative) {
			const deniedTrace: ToolTraceEntryType = {
				kind: "result",
				tool: taken.tool,
				status: "denied",
				durationMs: 0,
				summaryForLlm: "not run — user declined",
				args: taken.args,
				resolvedArgs: taken.resolvedArgs,
			}
			void updateInteraction({
				id: interactionId,
				skillProviderUsed:
					taken.tool.split(SKILL_TOOL_NAME_SEPARATOR)[0] ?? null,
				skillResponse: [deniedTrace],
			}).catch((err: unknown) =>
				domiaBusLogger.warn("confirmation: denied-tool persist failed", {
					interactionId,
					err,
				}),
			)
			replyConfirm(phrases.cancelledAction)
			return true
		}
		const offTopicWords = transcript.trim().split(/\s+/).filter(Boolean).length
		if (
			!taken &&
			affirmative === negative &&
			offTopicWords <= 4 &&
			!pending.reasked
		) {
			markConfirmationReasked(confirmScope)
			replyConfirm(phrases.confirmReask)
			return true
		}
		if (affirmative === negative) settleConfirmation(confirmScope, "ignored")
	}
	return false
}

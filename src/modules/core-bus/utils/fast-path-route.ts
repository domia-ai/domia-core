import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import {
	DEFAULT_CONFIRMATION_TTL_MS,
	SKILL_TOOL_NAME_SEPARATOR,
	type ToolTraceEntryType,
} from "@/db"
import { domiaBusLogger, getTraceContext, languageSetsFor } from "@/utils"
import { updateInteraction } from "@/modules/session-manager"
import { matchFastPath } from "@/modules/fast-path"
import {
	callTool,
	getInvocationPolicy,
	resolveToolFinalize,
	renderFinalizeText,
} from "@/modules/skill-engine"
import { cachedTtsPcmChunks, ttsPoolBusy } from "@/modules/tts-engine"
import {
	parkConfirmation,
	confirmationScope,
	summarizeConfirmAction,
} from "@/modules/agent"

import { skillsEnabled } from "./skill-routing"
import { getInteractionRuntime } from "./interaction-runtime"
import { lastActedEntity } from "./recent-tools"
import type { CoreBusContextType, SttDonePayloadType } from "../types"

const resolveAnaphora = async (
	domia: CoreBusContextType["domia"],
	transcript: string,
): Promise<string> => {
	const rewrites = languageSetsFor(
		domia.characterProfile?.language,
	).anaphoraRewrites
	const trimmed = transcript.trim()
	for (const { re, template } of rewrites) {
		const match = re.exec(trimmed)
		if (!match) continue
		const entity = await lastActedEntity(domia).catch(() => null)
		if (!entity) return transcript
		let rewritten = template.replace("{entity}", entity)
		for (let g = 1; g < match.length; g++)
			rewritten = rewritten.replace(`$${g}`, match[g] ?? "")
		domiaBusLogger.info(`⚡ anaphora resolved: "${trimmed}" → "${rewritten}"`, {
			domiaId: domia.id,
		})
		return rewritten
	}
	return transcript
}

export const prewarmFastPathPhrase = (
	ctx: CoreBusContextType,
	transcript: string,
): boolean => {
	const { domia } = ctx
	const verdict = matchFastPath(domia, transcript)
	if (verdict.kind !== "match") return false
	const tts = ctx.features.tts
	if (!tts || !domia.ttsConfig?.phraseCacheEnabled || ttsPoolBusy()) return true
	const match = verdict.match
	const invocation = getInvocationPolicy(
		domia.id,
		match.namespacedName,
		match.resolvedArgs,
	)
	if (invocation.policy !== "allow") return true
	const finalize = resolveToolFinalize(domia.id, match.namespacedName)
	if (finalize && (finalize.mode === "agent_loop" || finalize.mode === "async"))
		return true
	const phrases = languageSetsFor(domia.characterProfile?.language).phrases
	const template = finalize?.done ?? finalize?.ack
	const fallback = phrases.thatIsDone ?? "Done."
	const text = template
		? (renderFinalizeText(template, match.args, match.resolvedArgs) ?? fallback)
		: fallback
	domiaBusLogger.info(`🔮 fast-path phrase prewarm: "${text}"`, {
		domiaId: domia.id,
	})
	void (async () => {
		for await (const chunk of cachedTtsPcmChunks(domia, tts.adapter, text))
			void chunk
	})().catch((err) =>
		domiaBusLogger.warn("fast-path phrase prewarm failed", {
			domiaId: domia.id,
			err,
		}),
	)
	return true
}

export const attemptFastPathRoute = async (
	ctx: CoreBusContextType,
	payload: SttDonePayloadType,
	interactionId: string,
	transcript: string,
	originDomiaKey: string,
): Promise<boolean> => {
	const { domia } = ctx
	if (!skillsEnabled(ctx)) return false
	const effectiveTranscript = await resolveAnaphora(domia, transcript)
	const verdict = matchFastPath(domia, effectiveTranscript)
	if (verdict.kind !== "match") {
		if (verdict.reason !== "disabled")
			void updateInteraction({
				id: interactionId,
				fastPathMs: verdict.fastPathMs,
			}).catch(() => undefined)
		return false
	}
	const match = verdict.match
	const language = domia.characterProfile?.language ?? null
	const phrases = languageSetsFor(language).phrases
	const reply = (text: string): void =>
		publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
			reply: text,
			transcript,
			interactionId,
			originDomiaKey,
			responseType: payload.responseType,
			speechEndAt: payload.speechEndAt,
			liveVoice: payload.liveVoice,
		})
	const invocation = getInvocationPolicy(
		domia.id,
		match.namespacedName,
		match.resolvedArgs,
	)
	if (invocation.policy === "block") return false
	const finalize = resolveToolFinalize(domia.id, match.namespacedName)
	if (finalize && (finalize.mode === "agent_loop" || finalize.mode === "async"))
		return false
	if (invocation.policy === "confirm") {
		const runtime = getInteractionRuntime(interactionId)
		const scope = confirmationScope(
			domia.domiaKey,
			runtime?.envelope.satelliteId ?? runtime?.envelope.source,
		)
		const summary = summarizeConfirmAction(
			match.namespacedName,
			match.resolvedArgs,
		)
		parkConfirmation(
			scope,
			{
				tool: match.namespacedName,
				args: match.args,
				resolvedArgs: match.resolvedArgs,
				language,
				summary,
			},
			domia.llmModelConfig?.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS,
		)
		void updateInteraction({
			id: interactionId,
			intentDecision: `fast-path:${match.namespacedName}`,
			fastPathMs: verdict.fastPathMs,
			intentMs: verdict.fastPathMs,
		}).catch(() => undefined)
		const confirmPhrase =
			phrases.confirmAction ?? "Do you want me to go ahead with that?"
		domiaBusLogger.info(
			`⚡ fast-path confirm ${match.namespacedName} (${match.template})`,
			{ domiaId: domia.id, interactionId },
		)
		reply(summary ? `${summary} ${confirmPhrase}` : confirmPhrase)
		return true
	}
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.TOOL_REQUESTED,
		interactionId,
		originDomiaKey,
		traceId: getTraceContext()?.traceId,
		toolName: match.namespacedName,
		provider: match.providerSlug,
	})
	const toolStart = Date.now()
	let trace: Extract<ToolTraceEntryType, { kind: "result" }>
	let text: string
	try {
		const res = await callTool(
			domia.id,
			match.namespacedName,
			match.resolvedArgs,
			undefined,
			true,
		)
		const ok = res.status === "ok" && !res.isError
		const template = ok ? (finalize?.done ?? finalize?.ack) : finalize?.error
		const fallback = ok
			? (phrases.thatIsDone ?? "Done.")
			: (phrases.cantDoThat ?? "I couldn't do that.")
		text = template
			? (renderFinalizeText(template, match.args, res.resolvedArgs) ?? fallback)
			: fallback
		trace = {
			kind: "result",
			tool: match.namespacedName,
			status: ok ? "ok" : "failed",
			durationMs: Date.now() - toolStart,
			summaryForLlm: res.text,
			args: match.args,
			resolvedArgs: res.resolvedArgs,
		}
	} catch (err) {
		domiaBusLogger.warn("fast-path tool execution failed", {
			domiaId: domia.id,
			interactionId,
			err,
		})
		text = phrases.cantDoThat ?? "I couldn't do that."
		trace = {
			kind: "result",
			tool: match.namespacedName,
			status: "failed",
			durationMs: Date.now() - toolStart,
			summaryForLlm: String(err),
			args: match.args,
		}
	}
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.TOOL_RESULT,
		interactionId,
		originDomiaKey,
		traceId: getTraceContext()?.traceId,
		toolName: match.namespacedName,
		status: trace.status,
		toolMs: trace.durationMs,
	})
	void updateInteraction({
		id: interactionId,
		intentDecision: `fast-path:${match.namespacedName}`,
		fastPathMs: verdict.fastPathMs,
		intentMs: verdict.fastPathMs,
		skillProviderUsed:
			match.namespacedName.split(SKILL_TOOL_NAME_SEPARATOR)[0] ?? null,
		skillResponse: [trace],
		toolCallCount: 1,
		agentToolMs: trace.durationMs,
	}).catch(() => undefined)
	domiaBusLogger.info(
		`⚡ fast-path ${match.namespacedName} ${JSON.stringify(match.resolvedArgs)} → "${text}" (${verdict.fastPathMs}ms match, ${trace.durationMs}ms tool)`,
		{ domiaId: domia.id, interactionId },
	)
	reply(text)
	return true
}

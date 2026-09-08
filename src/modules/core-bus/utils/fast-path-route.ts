import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import {
	DEFAULT_CONFIRMATION_TTL_MS,
	SKILL_TOOL_NAME_SEPARATOR,
	type ToolTraceEntryType,
} from "@/db"
import { domiaBusLogger, getTraceContext, languageSetsFor } from "@/utils"
import { updateInteraction } from "@/modules/session-manager"
import {
	matchFastPath,
	matchBareEntity,
	type FastPathMatchType,
} from "@/modules/fast-path"
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
import {
	lastActedEntity,
	setClarifiedEntity,
	clearClarifiedEntity,
} from "./recent-tools"
import type {
	CoreBusContextType,
	SttDonePayloadType,
	FastPathOutcomeType,
} from "../types"

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
		const entity = await lastActedEntity(domia).catch((err: unknown) => {
			domiaBusLogger.warn("last-acted entity lookup failed — rewrite skipped", {
				err,
				domiaId: domia.id,
			})
			return null
		})
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
	const fallback = phrases.thatIsDone
	const text = template
		? (renderFinalizeText(template, match.args, match.resolvedArgs) ?? fallback)
		: fallback
	domiaBusLogger.info(`🔮 fast-path phrase prewarm: "${text}"`, {
		domiaId: domia.id,
	})
	void (async () => {
		for await (const chunk of cachedTtsPcmChunks(domia, tts.adapter, text))
			void chunk
	})().catch((err: unknown) =>
		domiaBusLogger.warn("fast-path phrase prewarm failed", {
			domiaId: domia.id,
			err,
		}),
	)
	return true
}

const emitIntentDecided = (
	interactionId: string,
	originDomiaKey: string,
	decision: string,
	intentMs: number,
): void =>
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.INTENT_DECIDED,
		interactionId,
		originDomiaKey,
		traceId: getTraceContext()?.traceId,
		decision,
		intentMs,
	})

const executeMatch = async (
	domia: CoreBusContextType["domia"],
	interactionId: string,
	originDomiaKey: string,
	match: FastPathMatchType,
): Promise<FastPathOutcomeType> => {
	const phrases = languageSetsFor(
		domia.characterProfile?.language ?? null,
	).phrases
	const finalize = resolveToolFinalize(domia.id, match.namespacedName)
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
		if (ok) clearClarifiedEntity(domia.id)
		const template = ok ? (finalize?.done ?? finalize?.ack) : finalize?.error
		const fallback = ok ? phrases.thatIsDone : phrases.cantDoThat
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
		text = phrases.cantDoThat
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
	return { text, trace }
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
	if (verdict.kind === "miss") {
		if (verdict.reason === "no_match") {
			const bare = matchBareEntity(domia, effectiveTranscript)
			if (bare) {
				setClarifiedEntity(domia.id, bare.name)
				const phrases = languageSetsFor(
					domia.characterProfile?.language ?? null,
				).phrases
				const question = phrases.clarifyWhatToDo.replace(
					"{entity}",
					bare.phrase,
				)
				void updateInteraction({
					id: interactionId,
					intentDecision: `clarify:${bare.name}`,
					fastPathMs: verdict.fastPathMs,
					intentMs: verdict.fastPathMs,
				}).catch((err: unknown) =>
					domiaBusLogger.warn("detached updateInteraction failed", { err }),
				)
				domiaBusLogger.info(
					`⚡ bare-entity clarify "${bare.phrase}" → asking`,
					{ domiaId: domia.id, interactionId },
				)
				publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.LLM_DONE, {
					reply: question,
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
		if (verdict.reason !== "disabled") {
			domiaBusLogger.debug(`⚡ fast-path miss (${verdict.reason})`, {
				domiaId: domia.id,
				interactionId,
				fastPathMs: verdict.fastPathMs,
			})
			void updateInteraction({
				id: interactionId,
				fastPathMs: verdict.fastPathMs,
			}).catch((err: unknown) =>
				domiaBusLogger.warn("detached updateInteraction failed", { err }),
			)
		}
		return false
	}
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
	const directlyRunnable = (m: FastPathMatchType): boolean => {
		const policy = getInvocationPolicy(
			domia.id,
			m.namespacedName,
			m.resolvedArgs,
		).policy
		if (policy !== "allow") return false
		const rule = resolveToolFinalize(domia.id, m.namespacedName)
		return !(rule && (rule.mode === "agent_loop" || rule.mode === "async"))
	}
	if (verdict.kind === "compound") {
		if (!verdict.matches.every(directlyRunnable)) return false
		const outcomes: FastPathOutcomeType[] = []
		for (const m of verdict.matches)
			outcomes.push(await executeMatch(domia, interactionId, originDomiaKey, m))
		const traces = outcomes.map((o) => o.trace)
		const text = [...new Set(outcomes.map((o) => o.text))].join(" ")
		emitIntentDecided(
			interactionId,
			originDomiaKey,
			`fast-path:compound(${verdict.matches.length})`,
			verdict.fastPathMs,
		)
		void updateInteraction({
			id: interactionId,
			intentDecision: `fast-path:compound(${verdict.matches.length})`,
			fastPathMs: verdict.fastPathMs,
			intentMs: verdict.fastPathMs,
			skillProviderUsed:
				verdict.matches[0].namespacedName.split(SKILL_TOOL_NAME_SEPARATOR)[0] ??
				null,
			skillResponse: traces,
			toolCallCount: traces.length,
			agentToolMs: traces.reduce((sum, t) => sum + t.durationMs, 0),
		}).catch((err: unknown) =>
			domiaBusLogger.warn("detached updateInteraction failed", { err }),
		)
		domiaBusLogger.info(
			`⚡ fast-path compound ${verdict.matches.map((m) => `${m.namespacedName} ${JSON.stringify(m.resolvedArgs)}`).join(" + ")} → "${text}" (${verdict.fastPathMs}ms match)`,
			{ domiaId: domia.id, interactionId },
		)
		reply(text)
		return true
	}
	const match = verdict.match
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
			domia.id,
			match.namespacedName,
			match.resolvedArgs,
			language,
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
		emitIntentDecided(
			interactionId,
			originDomiaKey,
			`fast-path:${match.namespacedName}`,
			verdict.fastPathMs,
		)
		void updateInteraction({
			id: interactionId,
			intentDecision: `fast-path:${match.namespacedName}`,
			fastPathMs: verdict.fastPathMs,
			intentMs: verdict.fastPathMs,
		}).catch((err: unknown) =>
			domiaBusLogger.warn("detached updateInteraction failed", { err }),
		)
		const confirmPhrase = phrases.confirmAction
		domiaBusLogger.info(
			`⚡ fast-path confirm ${match.namespacedName} (${match.template})`,
			{ domiaId: domia.id, interactionId },
		)
		reply(summary ? `${summary} ${confirmPhrase}` : confirmPhrase)
		return true
	}
	const { text, trace } = await executeMatch(
		domia,
		interactionId,
		originDomiaKey,
		match,
	)
	emitIntentDecided(
		interactionId,
		originDomiaKey,
		`fast-path:${match.namespacedName}`,
		verdict.fastPathMs,
	)
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
	}).catch((err: unknown) =>
		domiaBusLogger.warn("detached updateInteraction failed", { err }),
	)
	domiaBusLogger.info(
		`⚡ fast-path ${match.namespacedName} ${JSON.stringify(match.resolvedArgs)} → "${text}" (${verdict.fastPathMs}ms match, ${trace.durationMs}ms tool)`,
		{ domiaId: domia.id, interactionId },
	)
	reply(text)
	return true
}

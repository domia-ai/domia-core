import { domiaBusLogger } from "@/utils"
import { DEFAULT_LLM_STREAM_IDLE_MS } from "@/db"
import { isIdentitySlotBusy } from "@/modules/llm-slots"
import type { EagerPrefillHandleType } from "@/buses"
import {
	takeMemoryBundle,
	prefetchMemoryBundle,
	buildRankedPromptContext,
	createTwoTierTracker,
	twoTierConfigFromWakeWord,
	countTwoTier,
	skillsMayIntercept,
	looksSkillish,
} from "../utils"
import type {
	CoreBusContextType,
	EagerPrefillRuntimeType,
	TwoTierWindowType,
} from "../types"

export const createEagerPrefill = (
	ctx: CoreBusContextType,
	interactionId: string,
	window: TwoTierWindowType,
): EagerPrefillRuntimeType | null => {
	const { domia, features } = ctx
	const config = twoTierConfigFromWakeWord(domia.wakeWordConfig)
	const prefill = features.llm?.adapter.prefill
	if (
		!config.enabled ||
		!features.canRunLlm ||
		!prefill ||
		window.eagerSilenceMs <= 0
	)
		return null
	const tracker = createTwoTierTracker(config, window)
	const meta = { domiaId: domia.id, interactionId }
	let inflight: {
		generation: number
		controller: AbortController
		settled: Promise<void>
	} | null = null
	let lastRanked: {
		generation: number
		knownFacts: string[]
		knowledgeBase: string[]
	} | null = null

	const abortInflight = (reason: string): void => {
		if (!inflight) return
		const live = inflight
		inflight = null
		if (live.controller.signal.aborted) return
		live.controller.abort()
		domiaBusLogger.info(
			`🔥 eager prefill g${live.generation} cancelled (${reason})`,
			meta,
		)
	}

	const issue = (generation: number, partial: string): void => {
		const controller = new AbortController()
		const capMs =
			domia.llmModelConfig?.llmStreamIdleMs ?? DEFAULT_LLM_STREAM_IDLE_MS
		const cap = setTimeout(() => controller.abort(), capMs)
		cap.unref()
		const aborted = (): boolean => controller.signal.aborted
		const settled = (async (): Promise<void> => {
			const bundle = await takeMemoryBundle(domia, interactionId)
			prefetchMemoryBundle(domia, interactionId)
			if (aborted()) return
			const ranked = await buildRankedPromptContext(domia, partial, bundle)
			lastRanked = {
				generation,
				knownFacts: ranked.knownFacts,
				knowledgeBase: ranked.knowledgeBase,
			}
			const { prompt } = ranked
			if (aborted()) return
			const startedAt = Date.now()
			const result = await prefill(domia, prompt, controller.signal)
			if (aborted()) return
			tracker.onSettled(generation)
			domiaBusLogger.info(
				`🔥 eager prefill g${generation} hot ("…${partial.slice(-32)}")`,
				{
					...meta,
					promptTokens: result.promptTokens,
					freshTokens: result.freshTokens,
					cachedTokens: result.cachedTokens,
					prefillMs: result.prefillMs,
					wallMs: Date.now() - startedAt,
				},
			)
		})()
			.catch((err: unknown) => {
				tracker.onFailed(generation)
				if (aborted()) return
				domiaBusLogger.warn(
					`🔥 eager prefill g${generation} failed (best-effort)`,
					{
						...meta,
						err,
					},
				)
			})
			.finally(() => {
				clearTimeout(cap)
				if (inflight?.generation === generation) inflight = null
			})
		inflight = { generation, controller, settled }
	}

	return {
		onEager: (partial) => {
			void (async () => {
				if (
					skillsMayIntercept(domia) &&
					(await looksSkillish(domia, partial))
				) {
					domiaBusLogger.info(
						`🔥 eager prefill skipped — skill-ish partial ("${partial.slice(0, 48)}")`,
						meta,
					)
					return
				}
				const decision = tracker.onEager(partial, {
					slotBusy: isIdentitySlotBusy(domia),
				})
				if (decision.action === "skip") {
					domiaBusLogger.debug(
						`🔥 eager prefill skipped (${decision.reason})`,
						meta,
					)
					return
				}
				countTwoTier(domia.id, "prefills")
				abortInflight("superseded")
				issue(decision.generation, decision.partial)
			})().catch((err: unknown) =>
				domiaBusLogger.warn("🔥 eager prefill gate failed (best-effort)", {
					...meta,
					err,
				}),
			)
		},
		onResume: () => {
			const decision = tracker.onResume()
			if (decision.action === "cancel") {
				countTwoTier(domia.id, "cancelled")
				abortInflight("speech resumed")
			}
		},
		handle: (final): EagerPrefillHandleType | undefined => {
			const decision = tracker.onFinal(final)
			if (decision.action === "decode") return undefined
			const live = inflight
			const cancel = (reason: string): void => abortInflight(reason)
			if (decision.action === "reprefill") {
				countTwoTier(domia.id, "reprefilled")
				abortInflight("final diverged")
				domiaBusLogger.info(
					`🔥 eager prefill g${decision.generation} diverged from the final — fresh prefill on decode`,
					meta,
				)
				return {
					partial: decision.partial,
					relation: "diverges",
					settled: Promise.resolve(),
					cancel,
				}
			}
			countTwoTier(domia.id, "reused")
			const reusable =
				lastRanked?.generation === decision.generation ? lastRanked : null
			return {
				partial: decision.partial,
				relation: decision.relation,
				settled: live?.settled ?? Promise.resolve(),
				cancel,
				knownFacts: reusable?.knownFacts,
				knowledgeBase: reusable?.knowledgeBase,
			}
		},
		discard: (reason) => abortInflight(reason),
		accepting: () =>
			tracker.state() !== "final" &&
			tracker.stats().prefills < config.maxEagerPrefills,
	}
}

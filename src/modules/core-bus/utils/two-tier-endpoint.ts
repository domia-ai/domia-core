import {
	type SelectWakeWordConfigType,
	DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
} from "@/db"
import type { EagerPrefillHandleType, EagerPrefillRelationType } from "@/buses"
import { domiaBusLogger } from "@/utils"

import type { DomiaType } from "@/modules/core"
import type {
	TwoTierEndpointConfigType,
	TwoTierWindowType,
	TwoTierTrackerType,
	TwoTierStateType,
	TwoTierStatsType,
	TwoTierSettleOutcomeType,
	CoreBusFeaturesType,
} from "../types"

export const normalizeWords = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, "")
		.split(/\s+/)
		.filter(Boolean)
		.join(" ")

export const eagerPrefillRelation = (
	partial: string,
	final: string,
): EagerPrefillRelationType => {
	const p = normalizeWords(partial)
	const f = normalizeWords(final)
	if (p === f) return "equal"
	if (p.length > 0 && f.startsWith(p)) return "extends"
	return "diverges"
}

export const twoTierConfigFromWakeWord = (
	config: SelectWakeWordConfigType | null | undefined,
): TwoTierEndpointConfigType => ({
	enabled: config?.twoTierEndpointEnabled === true,
	eagerMinPartialChars: config?.twoTierEagerMinPartialChars ?? 0,
	prefillIdleGuardMs: config?.twoTierPrefillIdleGuardMs ?? 0,
	resumeGraceMs: config?.twoTierResumeGraceMs ?? 0,
	maxEagerPrefills: config?.twoTierMaxEagerPrefills ?? 0,
	settleMaxWaitMs:
		config?.twoTierSettleMaxWaitMs ?? DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
})

export const twoTierEndpointArmed = (
	domia: DomiaType,
	features: CoreBusFeaturesType,
): boolean =>
	domia.wakeWordConfig?.twoTierEndpointEnabled === true &&
	domia.wakeWordConfig.speculativeSilenceMs > 0 &&
	features.canRunLlm &&
	Boolean(features.llm?.adapter.prefill)

export const createTwoTierTracker = (
	config: TwoTierEndpointConfigType,
	window: TwoTierWindowType,
): TwoTierTrackerType => {
	let state: TwoTierStateType = "listening"
	let generation = 0
	let lastResumeAt = Number.NEGATIVE_INFINITY
	let issued: {
		generation: number
		partial: string
		cancelled: boolean
		settled: boolean
	} | null = null
	const stats: TwoTierStatsType = {
		prefills: 0,
		cancelled: 0,
		reused: 0,
		reprefilled: 0,
	}

	return {
		state: () => state,
		onEager: (partial, env) => {
			const now = env.now ?? Date.now()
			if (!config.enabled) return { action: "skip", reason: "disabled" }
			if (state === "final") return { action: "skip", reason: "finalized" }
			const text = partial.trim()
			if (text.length < config.eagerMinPartialChars)
				return { action: "skip", reason: "short-partial" }
			if (
				window.debounceMs() - window.eagerSilenceMs <
				config.prefillIdleGuardMs
			)
				return { action: "skip", reason: "idle-guard" }
			if (stats.prefills >= config.maxEagerPrefills)
				return { action: "skip", reason: "max-prefills" }
			if (now - lastResumeAt < config.resumeGraceMs)
				return { action: "skip", reason: "resume-grace" }
			if (env.slotBusy) return { action: "skip", reason: "slot-busy" }
			if (
				issued &&
				issued.settled &&
				!issued.cancelled &&
				normalizeWords(issued.partial) === normalizeWords(text)
			)
				return { action: "skip", reason: "same-partial" }
			generation += 1
			stats.prefills += 1
			issued = { generation, partial: text, cancelled: false, settled: false }
			state = "eager"
			return { action: "prefill", generation, partial: text }
		},
		onSettled: (settledGeneration) => {
			if (issued?.generation === settledGeneration && !issued.cancelled)
				issued.settled = true
		},
		onFailed: (failedGeneration) => {
			if (issued?.generation === failedGeneration) issued.cancelled = true
		},
		onResume: (now) => {
			if (state === "final") return { action: "none" }
			lastResumeAt = now ?? Date.now()
			state = "resume"
			const live =
				issued && !issued.cancelled && !issued.settled ? issued : null
			state = "listening"
			if (!live) return { action: "none" }
			live.cancelled = true
			stats.cancelled += 1
			return { action: "cancel", generation: live.generation }
		},
		onFinal: (final) => {
			state = "final"
			if (!issued || issued.cancelled) return { action: "decode" }
			const relation = eagerPrefillRelation(issued.partial, final)
			if (relation === "diverges") {
				stats.reprefilled += 1
				return {
					action: "reprefill",
					generation: issued.generation,
					partial: issued.partial,
				}
			}
			stats.reused += 1
			return {
				action: "reuse",
				generation: issued.generation,
				partial: issued.partial,
				relation,
			}
		},
		stats: () => ({ ...stats }),
	}
}

export const settleEagerPrefill = async (
	handle: EagerPrefillHandleType | undefined,
	interactionId: string,
	maxWaitMs: number,
): Promise<TwoTierSettleOutcomeType> => {
	if (!handle) return "decode"
	if (handle.relation === "diverges") {
		handle.cancel("final diverged from eager partial")
		return "decode"
	}
	const waitStart = Date.now()
	let timer: ReturnType<typeof setTimeout> | undefined
	const timedOut = await Promise.race([
		handle.settled.then(() => false),
		new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(true), Math.max(0, maxWaitMs))
		}),
	])
	if (timer) clearTimeout(timer)
	if (timedOut) {
		handle.cancel(`eager prefill did not settle within ${maxWaitMs}ms`)
		domiaBusLogger.warn(
			`🧊 eager prefill did not settle within ${maxWaitMs}ms — cancelled, decoding cold`,
			{ interactionId },
		)
		return "decode"
	}
	domiaBusLogger.info(
		`🔥 eager prefill ${handle.relation === "equal" ? "matches" : "prefixes"} the final — decode on hot KV (waited ${Date.now() - waitStart}ms)`,
		{ interactionId },
	)
	return "reuse"
}

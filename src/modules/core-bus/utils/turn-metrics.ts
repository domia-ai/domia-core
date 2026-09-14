import type { DomiaType } from "@/modules/core"
import type {
	SpeculationStatsType,
	BargeInStatsType,
	TwoTierStatsType,
	TwoTierCounterKindType,
	WakeVerifierStatsType,
} from "../types"

const replyQueueWaitByInteraction = new Map<string, number>()

export const recordReplyQueueWait = (
	interactionId: string,
	waitMs: number,
): void => {
	if (replyQueueWaitByInteraction.size > 256) {
		const oldest = replyQueueWaitByInteraction.keys().next().value
		if (oldest) replyQueueWaitByInteraction.delete(oldest)
	}
	replyQueueWaitByInteraction.set(interactionId, waitMs)
}

export const takeReplyQueueWait = (interactionId: string): number | null => {
	const wait = replyQueueWaitByInteraction.get(interactionId)
	if (wait !== undefined) replyQueueWaitByInteraction.delete(interactionId)
	return wait ?? null
}

const speculationCountersByDomia = new Map<
	string,
	{ handedOff: number; wastedFirstUnit: number; discarded: number }
>()

const countersFor = (domiaId: string) => {
	const existing = speculationCountersByDomia.get(domiaId)
	if (existing) return existing
	const fresh = { handedOff: 0, wastedFirstUnit: 0, discarded: 0 }
	speculationCountersByDomia.set(domiaId, fresh)
	return fresh
}

export const countSpeculationHandoff = (domiaId: string): void => {
	countersFor(domiaId).handedOff += 1
}

export const countSpeculationWasted = (domiaId: string): void => {
	countersFor(domiaId).wastedFirstUnit += 1
}

export const countSpeculationDiscarded = (domiaId: string): void => {
	countersFor(domiaId).discarded += 1
}

export const speculationStats = (domiaId: string): SpeculationStatsType => {
	const counters = countersFor(domiaId)
	const total = counters.handedOff + counters.discarded
	return {
		...counters,
		wasteRate: total > 0 ? counters.discarded / total : 0,
	}
}

const twoTierCountersByDomia = new Map<string, TwoTierStatsType>()

const twoTierFor = (domiaId: string): TwoTierStatsType => {
	const existing = twoTierCountersByDomia.get(domiaId)
	if (existing) return existing
	const fresh = { prefills: 0, cancelled: 0, reused: 0, reprefilled: 0 }
	twoTierCountersByDomia.set(domiaId, fresh)
	return fresh
}

export const countTwoTier = (
	domiaId: string,
	kind: TwoTierCounterKindType,
): void => {
	twoTierFor(domiaId)[kind] += 1
}

export const twoTierStats = (domiaId: string): TwoTierStatsType => ({
	...twoTierFor(domiaId),
})

const bargeInCountersByDomia = new Map<
	string,
	{ resumed: number; escalated: number }
>()

const bargeInFor = (domiaId: string) => {
	const existing = bargeInCountersByDomia.get(domiaId)
	if (existing) return existing
	const fresh = { resumed: 0, escalated: 0 }
	bargeInCountersByDomia.set(domiaId, fresh)
	return fresh
}

export const countBargeInResumed = (domiaId: string): void => {
	bargeInFor(domiaId).resumed += 1
}

export const countBargeInEscalated = (domiaId: string): void => {
	bargeInFor(domiaId).escalated += 1
}

export const bargeInStats = (domiaId: string): BargeInStatsType => {
	const counters = bargeInFor(domiaId)
	const total = counters.resumed + counters.escalated
	return {
		...counters,
		recoveryRate: total > 0 ? counters.resumed / total : 0,
	}
}

const wakeVerifierCountersByDomia = new Map<
	string,
	{ accepted: number; rejected: number; failedOpen: number }
>()

const wakeVerifierFor = (domiaId: string) => {
	const existing = wakeVerifierCountersByDomia.get(domiaId)
	if (existing) return existing
	const fresh = { accepted: 0, rejected: 0, failedOpen: 0 }
	wakeVerifierCountersByDomia.set(domiaId, fresh)
	return fresh
}

export const countWakeVerified = (domiaId: string): void => {
	wakeVerifierFor(domiaId).accepted += 1
}

export const countWakeRejected = (domiaId: string): void => {
	wakeVerifierFor(domiaId).rejected += 1
}

export const countWakeVerifierFailedOpen = (domiaId: string): void => {
	wakeVerifierFor(domiaId).failedOpen += 1
}

export const wakeVerifierStats = (domiaId: string): WakeVerifierStatsType => {
	const counters = wakeVerifierFor(domiaId)
	const total = counters.accepted + counters.rejected
	return {
		...counters,
		rejectRate: total > 0 ? counters.rejected / total : 0,
	}
}

export const resourceCols = (domia: DomiaType) => {
	if (domia.moduleSettings?.metricsSampleResources === false) return {}
	const rss = process.memoryUsage().rss
	return { rssMb: Math.round(rss / (1024 * 1024)) }
}

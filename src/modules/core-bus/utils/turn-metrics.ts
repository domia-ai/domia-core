import type { DomiaType } from "@/modules/core"
import type { SpeculationStatsType, BargeInStatsType } from "../types"

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

export const resourceCols = (domia: DomiaType) => {
	if (domia.moduleSettings?.metricsSampleResources === false) return {}
	const rss = process.memoryUsage().rss
	return { rssMb: Math.round(rss / (1024 * 1024)) }
}

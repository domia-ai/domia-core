import type { DomiaType } from "@/modules/core"
import {
	getRecentTurns,
	getRecentUserMoods,
	getRecentTurnsAndMoods,
} from "@/modules/session-manager"
import {
	getFactStrings,
	getKnowledgeStrings,
	getPreviouslyStrings,
	getUserModelSummary,
} from "@/modules/memory"
import type { RecentTurnsAndMoodsType } from "@/modules/session-manager"
import type { MemoryBundleType } from "../types"

const PREFETCH_TTL_MS = 60_000

const cache = new Map<
	string,
	{ promise: Promise<MemoryBundleType>; at: number }
>()

const loadMemoryBundle = async (
	domia: DomiaType,
	interactionId: string,
): Promise<MemoryBundleType> => {
	const memoryOn = domia.moduleSettings?.memoryEngine !== false
	const emotionOn = domia.moduleSettings?.emotionEngine !== false
	const turnsAndMoods: Promise<RecentTurnsAndMoodsType> =
		memoryOn && emotionOn
			? getRecentTurnsAndMoods(domia, interactionId)
			: memoryOn
				? getRecentTurns(domia, interactionId).then((recentTurns) => ({
						recentTurns,
						userMoodTrend: [],
					}))
				: emotionOn
					? getRecentUserMoods(domia).then((userMoodTrend) => ({
							recentTurns: [],
							userMoodTrend,
						}))
					: Promise.resolve({ recentTurns: [], userMoodTrend: [] })
	const [
		{ recentTurns, userMoodTrend },
		knownFacts,
		knowledgeBase,
		previously,
		userModel,
	] = await Promise.all([
		turnsAndMoods,
		domia.moduleSettings?.factRecall !== false
			? getFactStrings(domia)
			: Promise.resolve([] as string[]),
		getKnowledgeStrings(domia),
		memoryOn ? getPreviouslyStrings(domia) : Promise.resolve([] as string[]),
		memoryOn ? getUserModelSummary(domia) : Promise.resolve(null),
	])
	return {
		recentTurns,
		knownFacts,
		knowledgeBase,
		previously,
		userModel,
		userMoodTrend,
	}
}

const evictExpired = (now: number): void => {
	for (const [key, entry] of cache) {
		if (now - entry.at > PREFETCH_TTL_MS) cache.delete(key)
	}
}

export const prefetchMemoryBundle = (
	domia: DomiaType,
	interactionId: string,
): void => {
	const now = Date.now()
	evictExpired(now)
	if (cache.has(interactionId)) return
	const promise = loadMemoryBundle(domia, interactionId)
	promise.catch(() => undefined)
	cache.set(interactionId, { promise, at: now })
}

export const takeMemoryBundle = async (
	domia: DomiaType,
	interactionId: string,
): Promise<MemoryBundleType> => {
	const cached = cache.get(interactionId)
	if (!cached) return loadMemoryBundle(domia, interactionId)
	cache.delete(interactionId)
	try {
		return await cached.promise
	} catch {
		return loadMemoryBundle(domia, interactionId)
	}
}

import type { DomiaType } from "@/modules/core"
import { getRecentTurns, getRecentUserMoods } from "@/modules/session-manager"
import { getFactStrings } from "@/modules/memory"
import type { RecentTurnType } from "@/modules/prompt-context-builder"
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
	const [recentTurns, knownFacts, userMoodTrend] = await Promise.all([
		domia.moduleSettings?.memoryEngine !== false
			? (getRecentTurns(domia, interactionId) as Promise<RecentTurnType[]>)
			: Promise.resolve([] as RecentTurnType[]),
		domia.moduleSettings?.factRecall !== false
			? getFactStrings(domia)
			: Promise.resolve([] as string[]),
		domia.moduleSettings?.emotionEngine !== false
			? getRecentUserMoods(domia)
			: Promise.resolve([] as string[]),
	])
	return { recentTurns, knownFacts, userMoodTrend }
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

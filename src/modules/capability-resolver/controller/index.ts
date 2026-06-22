import { type DomiaType } from "@/modules/core"
import { getDomiaById, isHostedIdentity } from "@/modules/core"
import { type CapabilityEnumType } from "@/db"
import dbAdapter from "../db-adapter"
import { resolveDomiaStreamingCapabilities } from "../utils"
import type { ResolvedDelegateType } from "../types"

const CACHE_TTL_MS = 4000

const proximityRank = (
	candidateKey: string | null | undefined,
	candidateIp: string | null | undefined,
	originIp: string | null | undefined,
): number => {
	if (candidateKey && isHostedIdentity(candidateKey)) return 0
	if (candidateIp && originIp && candidateIp === originIp) return 1
	return 2
}

const isStalePeer = (
	target: { lastSeenAt: number | null },
	staleAfterMs: number,
): boolean =>
	typeof target.lastSeenAt === "number" &&
	Date.now() - target.lastSeenAt > staleAfterMs
const cache = new Map<string, { at: number; value: ResolvedDelegateType[] }>()

export const invalidateCapabilityCache = (): void => cache.clear()

const resolveCapabilityDelegationsUncached = async (
	domia: DomiaType,
	capability: CapabilityEnumType,
): Promise<ResolvedDelegateType[]> => {
	const result: ResolvedDelegateType[] = []
	const seen = new Set<string>()

	const explicit = (domia?.capabilityDelegations ?? [])
		.filter(
			(delegation) =>
				delegation?.capability === capability && delegation?.isActive,
		)
		.sort((a, b) => {
			const pa = a?.priority ?? Infinity
			const pb = b?.priority ?? Infinity
			return pa - pb
		})

	for (const delegation of explicit) {
		const targetId = delegation?.delegateToDomiaId
		if (!targetId || seen.has(targetId)) continue
		const target = await getDomiaById(targetId)
		if (!target || !target.isActive) continue
		if (isStalePeer(target, domia.peerStaleAfterMs)) continue
		seen.add(target.id)
		result.push({
			domiaKey: target.domiaKey,
			domiaId: target.id,
			localIp: target.localIp,
			grpcPort: target.grpcPort,
			source: "explicit",
			streamingCapabilities: resolveDomiaStreamingCapabilities(target),
		})
	}

	const candidates = [
		...((await dbAdapter.findAvailableDomiasForCapability(capability)) ?? []),
	].sort(
		(a, b) =>
			proximityRank(a?.domia?.domiaKey, a?.domia?.localIp, domia.localIp) -
			proximityRank(b?.domia?.domiaKey, b?.domia?.localIp, domia.localIp),
	)
	for (const candidate of candidates) {
		const cd = candidate?.domia
		if (!cd) continue
		if (cd.id === domia?.id) continue
		if (seen.has(cd.id)) continue
		const target = await getDomiaById(cd.id)
		if (!target || !target.isActive) continue
		if (isStalePeer(target, domia.peerStaleAfterMs)) continue
		seen.add(target.id)
		result.push({
			domiaKey: target.domiaKey,
			domiaId: target.id,
			localIp: target.localIp,
			grpcPort: target.grpcPort,
			source: "discovered",
			streamingCapabilities: resolveDomiaStreamingCapabilities(target),
		})
	}

	return result
}

export const resolveCapabilityDelegations = async (
	domia: DomiaType,
	capability: CapabilityEnumType,
): Promise<ResolvedDelegateType[]> => {
	const key = `${domia?.id}|${capability}`
	const hit = cache.get(key)
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

	const value = await resolveCapabilityDelegationsUncached(domia, capability)
	cache.set(key, { at: Date.now(), value })
	return value
}

export const resolveCapabilityDelegation = async (
	domia: DomiaType,
	capability: CapabilityEnumType,
) => {
	const list = await resolveCapabilityDelegations(domia, capability)
	const winner = list[0]
	if (!winner) return null
	return {
		delegateToDomiaKey: winner.domiaKey,
		delegateToDomiaId: winner.domiaId,
	}
}

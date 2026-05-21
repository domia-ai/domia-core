import { type DomiaType } from "@/modules/core"
import { getDomiaById } from "@/modules/core"
import { type CapabilityEnumType } from "@/db"
import dbAdapter from "../db-adapter"
import { resolveDomiaStreamingCapabilities } from "../utils"
import type { ResolvedDelegateType } from "../types"

export const resolveCapabilityDelegations = async (
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

	const candidates =
		await dbAdapter.findAvailableDomiasForCapability(capability)
	for (const candidate of candidates ?? []) {
		const cd = candidate?.domia
		if (!cd) continue
		if (cd.id === domia?.id) continue
		if (seen.has(cd.id)) continue
		const target = await getDomiaById(cd.id)
		if (!target || !target.isActive) continue
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

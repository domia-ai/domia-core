import { type DomiaType, getOwnDomia, isHostedIdentity } from "@/modules/core"
import {
	resolveCoreBusFeatures,
	type CoreBusFeaturesType,
} from "@/modules/core-bus"
import {
	normalizeRuntimeCapabilities,
	type RuntimeCapabilitiesType,
} from "@/setups/environment"

export type LiveDomiaType = {
	domia: DomiaType
	features: CoreBusFeaturesType
}

const liveFrom = (
	domia: DomiaType,
	bootCapabilities: RuntimeCapabilitiesType,
): LiveDomiaType => {
	const capabilities = domia.runtimeCapabilities
		? normalizeRuntimeCapabilities(domia.runtimeCapabilities)
		: bootCapabilities
	return { domia, features: resolveCoreBusFeatures(domia, capabilities) }
}

export const resolveLiveDomia = async (
	bootDomia: DomiaType,
	bootCapabilities: RuntimeCapabilitiesType,
): Promise<LiveDomiaType> => {
	let domia: DomiaType
	try {
		domia = (await getOwnDomia(bootDomia.domiaKey)) ?? bootDomia
	} catch {
		domia = bootDomia
	}
	return liveFrom(domia, bootCapabilities)
}

export const resolveLiveIdentity = async (
	bootDomia: DomiaType,
	bootCapabilities: RuntimeCapabilitiesType,
	targetDomiaKey?: string,
): Promise<LiveDomiaType> => {
	if (!targetDomiaKey || targetDomiaKey === bootDomia.domiaKey) {
		return resolveLiveDomia(bootDomia, bootCapabilities)
	}
	if (!isHostedIdentity(targetDomiaKey)) {
		throw new Error(`identity not hosted: ${targetDomiaKey}`)
	}
	const resolved = await getOwnDomia(targetDomiaKey).catch(() => null)
	if (!resolved) {
		throw new Error(`identity not resolvable: ${targetDomiaKey}`)
	}
	return liveFrom(resolved, bootCapabilities)
}

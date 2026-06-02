import { type DomiaType, getOwnDomia } from "@/modules/core"
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

export const resolveLiveDomia = async (
	bootDomia: DomiaType,
	bootCapabilities: RuntimeCapabilitiesType,
): Promise<LiveDomiaType> => {
	let domia: DomiaType
	try {
		domia = (await getOwnDomia()) ?? bootDomia
	} catch {
		domia = bootDomia
	}
	const capabilities = domia.runtimeCapabilities
		? normalizeRuntimeCapabilities(domia.runtimeCapabilities)
		: bootCapabilities
	return { domia, features: resolveCoreBusFeatures(domia, capabilities) }
}

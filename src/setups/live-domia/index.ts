import {
	type DomiaType,
	getOwnDomia,
	safeOwnDomia,
	isHostedIdentity,
} from "@/modules/core"
import { resolveCoreBusFeatures } from "@/modules/core-bus"
import {
	normalizeRuntimeCapabilities,
	type RuntimeCapabilitiesType,
} from "@/setups/environment"

import type { LiveDomiaType } from "./types"
import { domiaError, CORE_ERRORS, appLogger } from "@/utils"

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
		throw domiaError(CORE_ERRORS.IDENTITY_NOT_HOSTED, {
			logger: appLogger,
			meta: { domiaKey: targetDomiaKey },
		})
	}
	const resolved = await safeOwnDomia(targetDomiaKey, "live-domia resolve")
	if (!resolved) {
		throw domiaError(CORE_ERRORS.IDENTITY_NOT_RESOLVABLE, {
			logger: appLogger,
			meta: { domiaKey: targetDomiaKey },
		})
	}
	return liveFrom(resolved, bootCapabilities)
}

import type { OriginCapabilitiesType } from "@/modules/skill-engine"
import {
	getExternalMediaControls,
	externalMediaKey,
} from "@/modules/audio-playback"

import { getPresence } from "./presence-registry"
import { getSatelliteControl } from "./satellite-registry"
import { getInteractionRuntime } from "./interaction-runtime"
import type { CoreBusContextType } from "../types"

export const originCapabilitiesOf = (
	originDomiaKey: string,
	satelliteId: string | undefined,
	source: string,
	canPlayback: boolean,
): OriginCapabilitiesType => {
	const localPlayback = !satelliteId && canPlayback
	if (!satelliteId)
		return {
			source,
			satelliteId: null,
			satelliteProtocol: null,
			connected: true,
			canSpeak: localPlayback,
			canAnnounce: localPlayback,
			canFollowUp: localPlayback,
			canConfirm: true,
			timerNative: false,
			volumeNative: false,
			localPlayback,
		}
	const satellite = getPresence(originDomiaKey)?.satellites.find(
		(s) => s.satelliteId === satelliteId,
	)
	const control = getSatelliteControl(originDomiaKey, satelliteId)
	const media = getExternalMediaControls(
		externalMediaKey(originDomiaKey, satelliteId),
	)
	return {
		source,
		satelliteId,
		satelliteProtocol: satellite?.protocol ?? null,
		connected: satellite?.connected ?? control !== null,
		canSpeak: satellite?.capabilities.canSpeak ?? true,
		canAnnounce: satellite?.capabilities.canAnnounce ?? control !== null,
		canFollowUp: satellite?.capabilities.canFollowUp ?? false,
		canConfirm: true,
		timerNative: !!control?.sendTimerEvent,
		volumeNative: !!control?.setVolume || media !== null,
		localPlayback: false,
	}
}

const resolveOriginCapabilities = (
	ctx: CoreBusContextType,
	originDomiaKey: string,
	satelliteId: string | undefined,
	source: string,
): OriginCapabilitiesType =>
	originCapabilitiesOf(
		originDomiaKey,
		satelliteId,
		source,
		ctx.features.canPlayback,
	)

export const originOfInteraction = (
	ctx: CoreBusContextType,
	interactionId: string,
): OriginCapabilitiesType | null => {
	const runtime = getInteractionRuntime(interactionId)
	if (!runtime) return null
	if (runtime.origin) return runtime.origin
	const origin = resolveOriginCapabilities(
		ctx,
		runtime.envelope.originDomiaKey,
		runtime.envelope.satelliteId,
		runtime.envelope.source,
	)
	runtime.origin = origin
	return origin
}

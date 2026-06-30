import type {
	StreamingSinkType,
	SatelliteAnnouncerType,
	SatelliteControlType,
} from "../types"

const controls = new Map<string, SatelliteControlType>()

const controlKey = (domiaKey: string, satelliteId: string): string =>
	`${domiaKey}::${satelliteId}`

export const registerSatelliteControl = (
	control: SatelliteControlType,
): void => {
	controls.set(controlKey(control.domiaKey, control.satelliteId), control)
}

export const unregisterSatelliteControl = (
	domiaKey: string,
	satelliteId: string,
): void => {
	controls.delete(controlKey(domiaKey, satelliteId))
}

export const getSatelliteControl = (
	domiaKey: string,
	satelliteId: string,
): SatelliteControlType | null =>
	controls.get(controlKey(domiaKey, satelliteId)) ?? null

const sinks = new Map<string, Set<StreamingSinkType>>()

const announcers = new Map<string, Set<SatelliteAnnouncerType>>()

export const registerSatelliteAnnouncer = (
	domiaKey: string,
	announcer: SatelliteAnnouncerType,
): void => {
	const set = announcers.get(domiaKey) ?? new Set<SatelliteAnnouncerType>()
	set.add(announcer)
	announcers.set(domiaKey, set)
}

export const unregisterSatelliteAnnouncer = (
	domiaKey: string,
	announcer: SatelliteAnnouncerType,
): void => {
	const set = announcers.get(domiaKey)
	if (!set) return
	set.delete(announcer)
	if (set.size === 0) announcers.delete(domiaKey)
}

export const getSatelliteAnnouncerFor = (
	domiaKey: string,
): SatelliteAnnouncerType | null => {
	const set = announcers.get(domiaKey)
	if (!set || set.size === 0) return null
	const targets = [...set]
	if (targets.length === 1) return targets[0]
	return (url) => {
		for (const t of targets) t(url)
	}
}

export const registerSatelliteSink = (
	domiaKey: string,
	sink: StreamingSinkType,
): void => {
	const set = sinks.get(domiaKey) ?? new Set<StreamingSinkType>()
	set.add(sink)
	sinks.set(domiaKey, set)
}

export const unregisterSatelliteSink = (
	domiaKey: string,
	sink: StreamingSinkType,
): void => {
	const set = sinks.get(domiaKey)
	if (!set) return
	set.delete(sink)
	if (set.size === 0) sinks.delete(domiaKey)
}

export const getSatelliteSinkFor = (
	domiaKey: string,
): StreamingSinkType | null => {
	const set = sinks.get(domiaKey)
	if (!set || set.size === 0) return null
	const targets = [...set]
	if (targets.length === 1) return targets[0]
	return {
		begin: async (format) => {
			for (const t of targets) await t.begin?.(format)
		},
		write: async (chunk) => {
			for (const t of targets) await t.write(chunk)
		},
		end: async () => {
			for (const t of targets) await t.end?.()
		},
	}
}

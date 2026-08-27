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

const sinks = new Map<string, Map<StreamingSinkType, string | null>>()

const announcers = new Map<string, Map<SatelliteAnnouncerType, string | null>>()

export const registerSatelliteAnnouncer = (
	domiaKey: string,
	announcer: SatelliteAnnouncerType,
	satelliteId?: string | null,
): void => {
	const set =
		announcers.get(domiaKey) ?? new Map<SatelliteAnnouncerType, string | null>()
	set.set(announcer, satelliteId ?? null)
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
	satelliteId?: string | null,
): SatelliteAnnouncerType | null => {
	const set = announcers.get(domiaKey)
	if (!set || set.size === 0) return null
	const targets =
		satelliteId != null
			? [...set.entries()]
					.filter(([, id]) => id === satelliteId)
					.map(([t]) => t)
			: [...set.keys()]
	if (targets.length === 0) return null
	if (targets.length === 1) return targets[0]
	return (url) => {
		for (const t of targets) t(url)
	}
}

export const registerSatelliteSink = (
	domiaKey: string,
	sink: StreamingSinkType,
	satelliteId?: string | null,
): void => {
	const set = sinks.get(domiaKey) ?? new Map<StreamingSinkType, string | null>()
	set.set(sink, satelliteId ?? null)
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
	satelliteId?: string | null,
): StreamingSinkType | null => {
	const set = sinks.get(domiaKey)
	if (!set || set.size === 0) return null
	const targets =
		satelliteId != null
			? [...set.entries()]
					.filter(([, id]) => id === satelliteId)
					.map(([t]) => t)
			: [...set.keys()]
	if (targets.length === 0) return null
	if (targets.length === 1) return targets[0]
	const fidelities = ["none", "sentence", "estimated", "exact"] as const
	const weakest = targets.reduce<(typeof fidelities)[number]>((acc, t) => {
		const f = t.capabilities?.position ?? "none"
		return fidelities.indexOf(f) < fidelities.indexOf(acc) ? f : acc
	}, "exact")
	return {
		capabilities: {
			pause: targets.every((t) => t.capabilities?.pause === true),
			position: weakest,
			urlPlayback: targets.every((t) => t.capabilities?.urlPlayback === true),
			captions: targets.every((t) => t.capabilities?.captions === true),
		},
		pause: () => targets.every((t) => t.pause?.() === true),
		resume: () => targets.every((t) => t.resume?.() === true),
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

import type { StreamingSinkType } from "../types"

const sinks = new Map<string, Set<StreamingSinkType>>()

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

export const getSatelliteDomiaKeys = (): string[] => [...sinks.keys()]

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

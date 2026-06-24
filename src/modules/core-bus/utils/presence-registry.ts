import { domiaBusLogger } from "@/utils"

import type {
	PresenceEntryType,
	SatellitePresenceType,
	PresenceStatusType,
	SatelliteProtocolType,
	SatelliteMetaPatchType,
	PresenceListenerType,
} from "../types"

const presence = new Map<string, PresenceEntryType>()

const listeners = new Map<string, Set<PresenceListenerType>>()

const emit = (domiaKey: string, status: PresenceStatusType): void => {
	const set = listeners.get(domiaKey)
	if (!set) return
	for (const fn of set) {
		try {
			fn(status)
		} catch (err) {
			domiaBusLogger.warn("presence listener threw", {
				domiaKey,
				status,
				err: err instanceof Error ? err.message : String(err),
			})
		}
	}
}

export const onPresenceChange = (
	domiaKey: string,
	listener: PresenceListenerType,
): (() => void) => {
	const set = listeners.get(domiaKey) ?? new Set()
	set.add(listener)
	listeners.set(domiaKey, set)
	return () => {
		set.delete(listener)
		if (set.size === 0) listeners.delete(domiaKey)
	}
}

const ensure = (domiaKey: string): PresenceEntryType => {
	const existing = presence.get(domiaKey)
	if (existing) return existing
	const fresh: PresenceEntryType = {
		domiaKey,
		status: "idle",
		lastActiveAt: null,
		satellites: [],
	}
	presence.set(domiaKey, fresh)
	return fresh
}

const ensureSatellite = (
	entry: PresenceEntryType,
	satelliteId: string,
	protocol: SatelliteProtocolType,
): SatellitePresenceType => {
	const found = entry.satellites.find((s) => s.satelliteId === satelliteId)
	if (found) {
		found.protocol = protocol
		return found
	}
	const fresh: SatellitePresenceType = {
		satelliteId,
		protocol,
		connected: false,
		connecting: false,
		connectedAt: null,
		lastError: null,
		lastErrorAt: null,
		reconnectCount: 0,
		micActive: false,
		sampleRate: null,
		lastTurnAt: null,
		lastPlaybackAt: null,
		availableWakeWords: [],
		activeWakeWords: [],
		numberEntities: [],
	}
	entry.satellites.push(fresh)
	return fresh
}

export const updateSatelliteMeta = (
	domiaKey: string,
	satelliteId: string,
	protocol: SatelliteProtocolType,
	patch: SatelliteMetaPatchType,
): void => {
	const sat = ensureSatellite(ensure(domiaKey), satelliteId, protocol)
	Object.assign(sat, patch)
}

export const setSatelliteConnecting = (
	domiaKey: string,
	satelliteId: string,
	protocol: SatelliteProtocolType,
): void => {
	const sat = ensureSatellite(ensure(domiaKey), satelliteId, protocol)
	sat.connecting = true
	sat.connected = false
}

export const setSatellitePresence = (
	domiaKey: string,
	satelliteId: string,
	protocol: SatelliteProtocolType,
): void => {
	const entry = ensure(domiaKey)
	const sat = ensureSatellite(entry, satelliteId, protocol)
	sat.connected = true
	sat.connecting = false
	sat.connectedAt = Date.now()
	sat.lastError = null
	sat.lastErrorAt = null
	entry.status = "idle"
}

export const setSatelliteError = (
	domiaKey: string,
	satelliteId: string,
	protocol: SatelliteProtocolType,
	message: string,
): void => {
	const sat = ensureSatellite(ensure(domiaKey), satelliteId, protocol)
	sat.connected = false
	sat.connecting = false
	sat.connectedAt = null
	sat.lastError = message
	sat.lastErrorAt = Date.now()
}

export const clearSatellitePresence = (
	domiaKey: string,
	satelliteId: string,
): void => {
	const entry = presence.get(domiaKey)
	if (!entry) return
	entry.satellites = entry.satellites.filter(
		(s) => s.satelliteId !== satelliteId,
	)
	if (entry.satellites.length === 0) entry.status = "idle"
}

export const setPresenceStatus = (
	domiaKey: string,
	status: PresenceStatusType,
	markActive = false,
): void => {
	const entry = ensure(domiaKey)
	entry.status = status
	if (markActive) entry.lastActiveAt = Date.now()
	emit(domiaKey, status)
}

export const getPresence = (domiaKey: string): PresenceEntryType | undefined =>
	presence.get(domiaKey)

export const getAllPresence = (): PresenceEntryType[] => [...presence.values()]

export const mostRecentlyActiveSatellite = (): string | null => {
	let best: PresenceEntryType | null = null
	for (const entry of presence.values()) {
		const hasConnected = entry.satellites.some((s) => s.connected)
		if (!hasConnected || entry.lastActiveAt === null) continue
		if (!best || entry.lastActiveAt > (best.lastActiveAt ?? 0)) best = entry
	}
	return best?.domiaKey ?? null
}

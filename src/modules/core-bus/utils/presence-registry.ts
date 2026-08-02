import { domiaBusLogger, generateUuid } from "@/utils"

import type {
	PresenceEntryType,
	SatellitePresenceType,
	PresenceStatusType,
	SatelliteProtocolType,
	SatelliteMetaPatchType,
	SatelliteCapabilitiesType,
	SetSatellitePresenceMetaType,
	SatelliteEventKindType,
	PresenceListenerType,
} from "../types"

const MAX_SATELLITE_EVENTS = 10

const NO_CAPABILITIES: SatelliteCapabilitiesType = {
	canHear: false,
	canSpeak: false,
	canAnnounce: false,
	canIntercom: false,
	canFollowUp: false,
}

const presence = new Map<string, PresenceEntryType>()

const connectionIds = new Map<string, string>()

const connKey = (domiaKey: string, satelliteId: string): string =>
	`${domiaKey}\u0000${satelliteId}`

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
		volume: null,
		capabilities: { ...NO_CAPABILITIES },
		firmwareVersion: null,
		recentEvents: [],
	}
	entry.satellites.push(fresh)
	return fresh
}

const pushEvent = (
	sat: SatellitePresenceType,
	kind: SatelliteEventKindType,
	detail: string,
): void => {
	sat.recentEvents.unshift({ id: generateUuid(), kind, detail, at: Date.now() })
	if (sat.recentEvents.length > MAX_SATELLITE_EVENTS)
		sat.recentEvents.length = MAX_SATELLITE_EVENTS
}

export const updateSatelliteMeta = (
	domiaKey: string,
	satelliteId: string,
	protocol: SatelliteProtocolType,
	patch: SatelliteMetaPatchType,
): void => {
	const sat = ensureSatellite(ensure(domiaKey), satelliteId, protocol)
	Object.assign(sat, patch)
	if (patch.lastTurnAt) pushEvent(sat, "wake", "Heard speech")
	if (patch.lastPlaybackAt) pushEvent(sat, "playback", "Played audio")
	if (patch.reconnectCount)
		pushEvent(sat, "reconnect", `Reconnect attempt ${patch.reconnectCount}`)
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
	meta?: SetSatellitePresenceMetaType,
): void => {
	const entry = ensure(domiaKey)
	const sat = ensureSatellite(entry, satelliteId, protocol)
	sat.connected = true
	sat.connecting = false
	sat.connectedAt = Date.now()
	sat.lastError = null
	sat.lastErrorAt = null
	if (meta?.capabilities) sat.capabilities = meta.capabilities
	if (meta?.connectionId)
		connectionIds.set(connKey(domiaKey, satelliteId), meta.connectionId)
	entry.status = "idle"
}

export const pushSatelliteEvent = (
	domiaKey: string,
	satelliteId: string,
	kind: SatelliteEventKindType,
	detail: string,
): void => {
	const entry = presence.get(domiaKey)
	const sat = entry?.satellites.find((s) => s.satelliteId === satelliteId)
	if (sat) pushEvent(sat, kind, detail)
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
	pushEvent(sat, "error", message)
}

export const clearSatellitePresence = (
	domiaKey: string,
	satelliteId: string,
	connectionId?: string,
): void => {
	const entry = presence.get(domiaKey)
	if (!entry) return
	const key = connKey(domiaKey, satelliteId)
	const owner = connectionIds.get(key)
	if (connectionId && owner && owner !== connectionId) return
	connectionIds.delete(key)
	entry.satellites = entry.satellites.filter(
		(s) => s.satelliteId !== satelliteId,
	)
	if (entry.satellites.length === 0) entry.status = "idle"
}

let speakingBroadcast: ((domiaKey: string, speaking: boolean) => void) | null =
	null

const SPEAKING_KEEPALIVE_MS = 5_000
const speakingKeepalives = new Map<string, ReturnType<typeof setInterval>>()

export const registerSpeakingBroadcast = (
	fn: (domiaKey: string, speaking: boolean) => void,
): void => {
	speakingBroadcast = fn
}

const stopSpeakingKeepalive = (domiaKey: string): void => {
	const timer = speakingKeepalives.get(domiaKey)
	if (!timer) return
	clearInterval(timer)
	speakingKeepalives.delete(domiaKey)
}

const startSpeakingKeepalive = (domiaKey: string): void => {
	stopSpeakingKeepalive(domiaKey)
	const timer = setInterval(
		() => speakingBroadcast?.(domiaKey, true),
		SPEAKING_KEEPALIVE_MS,
	)
	timer.unref?.()
	speakingKeepalives.set(domiaKey, timer)
}

export const setPresenceStatus = (
	domiaKey: string,
	status: PresenceStatusType,
	markActive = false,
): void => {
	const entry = ensure(domiaKey)
	const prev = entry.status
	entry.status = status
	if (markActive) entry.lastActiveAt = Date.now()
	emit(domiaKey, status)
	if (prev !== status && (status === "speaking" || prev === "speaking")) {
		const speaking = status === "speaking"
		speakingBroadcast?.(domiaKey, speaking)
		if (speaking) startSpeakingKeepalive(domiaKey)
		else stopSpeakingKeepalive(domiaKey)
	}
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

export const clearDomiaPresence = (domiaKey: string): void => {
	stopSpeakingKeepalive(domiaKey)
	presence.delete(domiaKey)
	listeners.delete(domiaKey)
	const prefix = `${domiaKey}\u0000`
	for (const key of connectionIds.keys()) {
		if (key.startsWith(prefix)) connectionIds.delete(key)
	}
}

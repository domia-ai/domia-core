import { createHash } from "crypto"
import { EventEmitter } from "events"

import type { SelectSkillProviderType } from "@/db"
import {
	HA_DATA_PLANE_ENUM,
	DEFAULT_HA_DATA_PLANE,
	DEFAULT_HA_WS_PATH,
	DEFAULT_HA_WS_MAX_ENTITIES,
} from "@/db"
import { skillEngineLogger } from "@/utils"

import { createHaWsClient } from "./ws-client"
import { fold } from "./text"
import type {
	HaDestinationType,
	HaDataPlaneConfigType,
	HaLiveEntityType,
	HaWsSnapshotType,
	HaStateObjectType,
	HaContextCacheType,
	HaEntityType,
	SkillConnHandleType,
} from "../../types"

const destinations = new Map<string, HaDestinationType>()
const providerAttachments = new Map<
	string,
	{ destKey: string; handle: SkillConnHandleType }
>()

export const dataPlaneEmitter = new EventEmitter()

export const resolveDataPlaneConfig = (
	provider: SelectSkillProviderType,
): HaDataPlaneConfigType => {
	const config = provider.config as {
		dataPlane?: unknown
		wsUrl?: unknown
	} | null
	const dataPlane =
		config?.dataPlane === HA_DATA_PLANE_ENUM.WS
			? HA_DATA_PLANE_ENUM.WS
			: DEFAULT_HA_DATA_PLANE
	const override =
		typeof config?.wsUrl === "string" && config.wsUrl.trim()
			? config.wsUrl.trim()
			: null
	return { dataPlane, wsUrl: override ?? deriveWsUrl(provider.url) }
}

const deriveWsUrl = (providerUrl: string): string | null => {
	try {
		const url = new URL(providerUrl)
		const protocol =
			url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:"
		return `${protocol}//${url.host}${DEFAULT_HA_WS_PATH}`
	} catch {
		return null
	}
}

const bearerToken = (provider: SelectSkillProviderType): string | null =>
	provider.auth?.kind === "bearer" && provider.auth.token
		? provider.auth.token
		: null

const destinationKey = (wsUrl: string, token: string): string => {
	const normalized = wsUrl.toLowerCase().replace(/\/+$/, "")
	const tokenHash = createHash("sha256")
		.update(token)
		.digest("hex")
		.slice(0, 16)
	return `${normalized}#${tokenHash}`
}

const domainOf = (entityId: string): string => entityId.split(".")[0] ?? ""

const entityFromState = (
	dest: HaDestinationType,
	entityId: string,
	state: HaStateObjectType | null,
): HaLiveEntityType => {
	const attributes = state?.attributes ?? {}
	const friendlyName =
		typeof attributes.friendly_name === "string"
			? attributes.friendly_name
			: null
	const registry = dest.registryByEntityId.get(entityId)
	const areaId =
		registry?.areaId ??
		(registry?.deviceId
			? (dest.devicesById.get(registry.deviceId) ?? null)
			: null)
	const derivedName = entityId.split(".")[1]?.replace(/_/g, " ") ?? null
	const names = [
		...new Set(
			[
				friendlyName,
				registry?.name ?? null,
				registry?.originalName ?? null,
				...(registry?.aliases ?? []),
				derivedName,
			].filter((n): n is string => !!n),
		),
	]
	return {
		entityId,
		state: typeof state?.state === "string" ? state.state : null,
		friendlyName,
		names: names.length > 0 ? names : [entityId],
		domain: domainOf(entityId),
		area: areaId ? (dest.areasById.get(areaId) ?? null) : null,
		lastChanged:
			typeof state?.last_changed === "string" ? state.last_changed : null,
	}
}

const includeEntity = (dest: HaDestinationType, entityId: string): boolean => {
	const registry = dest.registryByEntityId.get(entityId)
	if (registry && (registry.disabled || registry.hidden)) return false
	if (dest.exposedEntityIds && !dest.exposedEntityIds.has(entityId))
		return false
	return true
}

const applySnapshot = (
	dest: HaDestinationType,
	snapshot: HaWsSnapshotType,
): void => {
	dest.registryByEntityId = new Map(
		snapshot.entityRegistry.map((r) => [r.entityId, r]),
	)
	dest.areasById = new Map(snapshot.areaRegistry.map((a) => [a.areaId, a.name]))
	dest.devicesById = new Map(
		snapshot.deviceRegistry.map((d) => [d.deviceId, d.areaId]),
	)
	dest.exposedEntityIds = snapshot.exposedEntityIds
	dest.entities.clear()
	for (const state of snapshot.states) {
		const entityId =
			typeof state.entity_id === "string" ? state.entity_id : null
		if (!entityId || !includeEntity(dest, entityId)) continue
		if (dest.entities.size >= DEFAULT_HA_WS_MAX_ENTITIES) {
			if (!dest.overflowWarned) {
				dest.overflowWarned = true
				skillEngineLogger.warn(
					`🏠 HA ws entity cap reached (${DEFAULT_HA_WS_MAX_ENTITIES}) — dropping extra entities`,
				)
			}
			break
		}
		dest.entities.set(entityId, entityFromState(dest, entityId, state))
	}
	dest.dirty = true
	dest.live = true
}

const applyEvent = (
	dest: HaDestinationType,
	entityId: string,
	newState: HaStateObjectType | null,
): void => {
	if (!includeEntity(dest, entityId)) return
	if (newState === null) {
		dest.entities.delete(entityId)
		dest.dirty = true
		return
	}
	if (
		!dest.entities.has(entityId) &&
		dest.entities.size >= DEFAULT_HA_WS_MAX_ENTITIES
	) {
		if (!dest.overflowWarned) {
			dest.overflowWarned = true
			skillEngineLogger.warn(
				`🏠 HA ws entity cap reached (${DEFAULT_HA_WS_MAX_ENTITIES}) — dropping extra entities`,
			)
		}
		return
	}
	dest.entities.set(entityId, entityFromState(dest, entityId, newState))
	dest.dirty = true
	dataPlaneEmitter.emit("state_changed", {
		providerIds: [...dest.attachedProviderIds],
		entityId,
		newState,
	})
}

const createDestination = (
	key: string,
	wsUrl: string,
	token: string,
): HaDestinationType => {
	const dest: HaDestinationType = {
		key,
		wsUrl,
		client: createHaWsClient({
			wsUrl,
			token,
			onSync: (snapshot) => {
				applySnapshot(dest, snapshot)
				skillEngineLogger.info(
					`🏠 HA ws live: ${dest.entities.size} entities, ${dest.areasById.size} areas (${wsUrl})`,
				)
			},
			onEvent: (entityId, newState) => applyEvent(dest, entityId, newState),
			onStatus: (state, reason) => {
				if (state === "backoff" || state === "closed") {
					dest.live = false
					skillEngineLogger.warn(
						`🏠 HA ws ${state === "closed" ? "closed" : "down"} (${reason ?? "unknown"}) — poll fallback active (${wsUrl})`,
					)
				}
			},
		}),
		attachedProviderIds: new Set(),
		entities: new Map(),
		areasById: new Map(),
		devicesById: new Map(),
		registryByEntityId: new Map(),
		exposedEntityIds: null,
		live: false,
		dirty: false,
		snapshot: null,
		overflowWarned: false,
	}
	return dest
}

export const attachDataPlane = (
	provider: SelectSkillProviderType,
	handle: SkillConnHandleType,
): void => {
	const config = resolveDataPlaneConfig(provider)
	if (config.dataPlane !== HA_DATA_PLANE_ENUM.WS) return
	if (!config.wsUrl) {
		skillEngineLogger.warn(
			"🏠 HA ws requested but no ws url derivable — staying on poll",
			{ provider: provider.name },
		)
		return
	}
	const token = bearerToken(provider)
	if (!token) {
		skillEngineLogger.warn(
			"🏠 HA ws requested but provider has no bearer token — staying on poll",
			{ provider: provider.name },
		)
		return
	}
	const key = destinationKey(config.wsUrl, token)
	const existing = providerAttachments.get(provider.id)
	if (existing?.destKey === key) return
	if (existing) detachDataPlane(provider.id)
	providerAttachments.set(provider.id, { destKey: key, handle })
	const dest = destinations.get(key)
	if (dest) {
		dest.attachedProviderIds.add(provider.id)
		skillEngineLogger.info(
			`🏠 HA ws shared (${dest.attachedProviderIds.size} providers on ${config.wsUrl})`,
		)
		return
	}
	const created = createDestination(key, config.wsUrl, token)
	created.attachedProviderIds.add(provider.id)
	destinations.set(key, created)
	skillEngineLogger.info(`🏠 HA ws connecting: ${config.wsUrl}`)
	created.client.connect()
}

export const detachDataPlane = (providerId: string): void => {
	const attachment = providerAttachments.get(providerId)
	if (!attachment) return
	providerAttachments.delete(providerId)
	const dest = destinations.get(attachment.destKey)
	if (!dest) return
	dest.attachedProviderIds.delete(providerId)
	if (dest.attachedProviderIds.size > 0) {
		skillEngineLogger.info(
			`🏠 HA ws detach (still shared by ${dest.attachedProviderIds.size} provider(s))`,
		)
		return
	}
	destinations.delete(attachment.destKey)
	dest.client.close()
	dest.entities.clear()
	skillEngineLogger.info("🏠 HA ws closed (last provider detached)")
}

const rebuildSnapshot = (
	dest: HaDestinationType,
	handle: SkillConnHandleType,
): HaContextCacheType => {
	const entities: HaEntityType[] = [...dest.entities.values()].map((e) => ({
		names: e.names,
		domain: e.domain,
		area: e.area,
		entityId: e.entityId,
		state: e.state,
		lastChanged: e.lastChanged,
	}))
	const areas = new Set(
		entities
			.map((e) => e.area)
			.filter((a): a is string => !!a)
			.map(fold),
	)
	return { entities, areas, fetchedAt: Date.now(), handle, source: "ws" }
}

export const snapshotContext = (
	providerId: string,
): HaContextCacheType | null => {
	const attachment = providerAttachments.get(providerId)
	if (!attachment) return null
	const dest = destinations.get(attachment.destKey)
	if (!dest || !dest.live || dest.client.state() !== "live") return null
	if (dest.dirty || !dest.snapshot) {
		dest.snapshot = rebuildSnapshot(dest, attachment.handle)
		dest.dirty = false
	}
	return { ...dest.snapshot, handle: attachment.handle }
}

export const liveEntities = (providerId: string): HaLiveEntityType[] | null => {
	const attachment = providerAttachments.get(providerId)
	if (!attachment) return null
	const dest = destinations.get(attachment.destKey)
	if (!dest || !dest.live || dest.client.state() !== "live") return null
	return [...dest.entities.values()]
}

export const queryEntityState = (
	providerId: string,
	entityId: string,
): HaLiveEntityType | null => {
	const attachment = providerAttachments.get(providerId)
	if (!attachment) return null
	const dest = destinations.get(attachment.destKey)
	if (!dest || !dest.live) return null
	return dest.entities.get(entityId) ?? null
}

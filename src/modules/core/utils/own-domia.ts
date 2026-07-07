import { DEFAULT_OWN_CONFIG_TTL_MS } from "@/db"
import { env } from "@/config/env"
import { appLogger } from "@/utils"

import { getDomia } from "../controller"
import type { DomiaType, OwnDomiaEntryType } from "../types"

const cache = new Map<string, OwnDomiaEntryType>()
const inflight = new Map<string, Promise<DomiaType | undefined>>()
const versions = new Map<string, number>()

const bumpVersion = (domiaKey: string): void => {
	versions.set(domiaKey, (versions.get(domiaKey) ?? 0) + 1)
}

export const invalidateOwnDomia = (domiaKey?: string): void => {
	if (domiaKey) {
		cache.delete(domiaKey)
		bumpVersion(domiaKey)
		return
	}
	cache.clear()
	for (const key of versions.keys()) bumpVersion(key)
}

export const getOwnDomia = async (
	domiaKey: string = env.DOMIA_KEY,
): Promise<DomiaType | undefined> => {
	const hit = cache.get(domiaKey)
	if (hit && hit.expiresAt > Date.now()) return hit.value
	const existing = inflight.get(domiaKey)
	if (existing) return existing

	const startVersion = versions.get(domiaKey) ?? 0
	const pending = (async () => {
		const fresh = await getDomia(domiaKey)
		if (fresh && (versions.get(domiaKey) ?? 0) === startVersion) {
			const ttl = fresh.ownConfigTtlMs ?? DEFAULT_OWN_CONFIG_TTL_MS
			cache.set(domiaKey, {
				value: fresh,
				expiresAt: ttl > 0 ? Date.now() + ttl : 0,
			})
		}
		return fresh
	})()
	inflight.set(domiaKey, pending)
	try {
		return await pending
	} finally {
		inflight.delete(domiaKey)
	}
}

export const safeOwnDomia = async (
	domiaKey?: string,
	context?: string,
): Promise<DomiaType | null> => {
	try {
		return (await getOwnDomia(domiaKey)) ?? null
	} catch (err) {
		appLogger.warn(`getOwnDomia failed${context ? ` (${context})` : ""}`, {
			domiaKey: domiaKey ?? env.DOMIA_KEY,
			err,
		})
		return null
	}
}

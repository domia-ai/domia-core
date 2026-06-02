import { DEFAULT_OWN_CONFIG_TTL_MS } from "@/db"

import { getDomia } from "../controller"
import type { DomiaType } from "../types"

let cache: { value: DomiaType; expiresAt: number } | null = null
let inflight: Promise<DomiaType | undefined> | null = null
let version = 0

export const invalidateOwnDomia = (): void => {
	cache = null
	version++
}

export const getOwnDomia = async (): Promise<DomiaType | undefined> => {
	if (cache && cache.expiresAt > Date.now()) return cache.value
	if (inflight) return inflight

	const startVersion = version
	inflight = (async () => {
		const fresh = await getDomia()
		if (fresh && version === startVersion) {
			const ttl = fresh.ownConfigTtlMs ?? DEFAULT_OWN_CONFIG_TTL_MS
			cache = { value: fresh, expiresAt: ttl > 0 ? Date.now() + ttl : 0 }
		}
		return fresh
	})()
	try {
		return await inflight
	} finally {
		inflight = null
	}
}

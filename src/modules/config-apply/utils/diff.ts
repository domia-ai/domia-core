import type { DomiaType } from "@/modules/core"

import {
	CONFIG_SECTION_META_FIELDS,
	CONFIG_SECTION_PROPS,
	DOMIA_LIVE_FIELDS,
} from "../constants"
import type { ConfigChangeType } from "../types"

const META = new Set<string>(CONFIG_SECTION_META_FIELDS)

const arrayChangedById = (
	a: unknown[] | null,
	b: unknown[] | null,
	idKey: string,
): boolean => {
	const norm = (arr: unknown[] | null): Map<string, string> => {
		const map = new Map<string, string>()
		for (const item of arr ?? []) {
			const id = String((item as Record<string, unknown>)[idKey])
			map.set(id, JSON.stringify(item))
		}
		return map
	}
	const ma = norm(a)
	const mb = norm(b)
	if (ma.size !== mb.size) return true
	for (const [k, v] of ma) if (mb.get(k) !== v) return true
	return false
}

const delegationKey = (item: unknown): string => {
	const d = item as Record<string, unknown>
	return [d.capability, d.delegateToDomiaKey, d.priority, d.isActive]
		.map((v) => String(v))
		.join("|")
}

const setChangedByKey = (
	a: unknown[] | null,
	b: unknown[] | null,
	keyOf: (item: unknown) => string,
): boolean => {
	const norm = (arr: unknown[] | null): Map<string, number> => {
		const map = new Map<string, number>()
		for (const item of arr ?? []) {
			const k = keyOf(item)
			map.set(k, (map.get(k) ?? 0) + 1)
		}
		return map
	}
	const ma = norm(a)
	const mb = norm(b)
	if (ma.size !== mb.size) return true
	for (const [k, v] of ma) if (mb.get(k) !== v) return true
	return false
}

export const diffConfig = (
	oldDomia: DomiaType,
	newDomia: DomiaType,
): ConfigChangeType[] => {
	const changes: ConfigChangeType[] = []
	const o = oldDomia as unknown as Record<string, unknown>
	const n = newDomia as unknown as Record<string, unknown>
	for (const field of DOMIA_LIVE_FIELDS)
		if (JSON.stringify(o[field]) !== JSON.stringify(n[field]))
			changes.push({ section: "domia", field })
	for (const { section, prop } of CONFIG_SECTION_PROPS) {
		const oo = (o[prop] ?? {}) as Record<string, unknown>
		const nn = (n[prop] ?? {}) as Record<string, unknown>
		for (const field of new Set([...Object.keys(oo), ...Object.keys(nn)])) {
			if (META.has(field)) continue
			if (oo[field] !== nn[field]) changes.push({ section, field })
		}
	}
	if (arrayChangedById(oldDomia.skillProviders, newDomia.skillProviders, "id"))
		changes.push({ section: "skillProviders", field: "*" })
	if (
		setChangedByKey(
			oldDomia.capabilityDelegations,
			newDomia.capabilityDelegations,
			delegationKey,
		)
	)
		changes.push({ section: "delegations", field: "*" })
	return changes
}

import { foldText } from "@/utils/text-tokens"

import type { MediaOwnerSnapshotType } from "../types"

const ownersByDomia = new Map<string, Map<string, Set<string>>>()
const versions = new Map<string, number>()

const bump = (domiaId: string): void => {
	versions.set(domiaId, (versions.get(domiaId) ?? 0) + 1)
}

export const setMediaOwnerNames = (
	domiaId: string,
	ownerId: string,
	names: string[],
): void => {
	const owners = ownersByDomia.get(domiaId) ?? new Map<string, Set<string>>()
	const folded = new Set(
		names.map((n) => foldText(n)).filter((n) => n.length > 0),
	)
	const previous = owners.get(ownerId)
	const unchanged =
		previous?.size === folded.size && [...folded].every((n) => previous.has(n))
	if (unchanged) return
	owners.set(ownerId, folded)
	ownersByDomia.set(domiaId, owners)
	bump(domiaId)
}

export const addMediaOwnerName = (
	domiaId: string,
	ownerId: string,
	name: string,
): void => {
	const folded = foldText(name)
	if (!folded) return
	const current = ownersByDomia.get(domiaId)?.get(ownerId) ?? new Set<string>()
	if (current.has(folded)) return
	setMediaOwnerNames(domiaId, ownerId, [...current, folded])
}

export const clearMediaOwner = (domiaId: string, ownerId: string): void => {
	const owners = ownersByDomia.get(domiaId)
	if (!owners?.delete(ownerId)) return
	if (owners.size === 0) ownersByDomia.delete(domiaId)
	bump(domiaId)
}

export const mediaOwnedNames = (domiaId: string): MediaOwnerSnapshotType => {
	const folded = new Set<string>()
	for (const names of ownersByDomia.get(domiaId)?.values() ?? [])
		for (const name of names) folded.add(name)
	return { folded, version: versions.get(domiaId) ?? 0 }
}

const deviceNamesByDomia = new Map<string, Map<string, Set<string>>>()

export const setDeviceOwnerNames = (
	domiaId: string,
	ownerId: string,
	names: string[],
): void => {
	const owners =
		deviceNamesByDomia.get(domiaId) ?? new Map<string, Set<string>>()
	owners.set(
		ownerId,
		new Set(names.map((n) => foldText(n)).filter((n) => n.length > 0)),
	)
	deviceNamesByDomia.set(domiaId, owners)
}

export const clearDeviceOwner = (domiaId: string, ownerId: string): void => {
	const owners = deviceNamesByDomia.get(domiaId)
	if (!owners?.delete(ownerId)) return
	if (owners.size === 0) deviceNamesByDomia.delete(domiaId)
}

export const isDeviceOwnedName = (domiaId: string, name: string): boolean => {
	const folded = foldText(name)
	for (const names of deviceNamesByDomia.get(domiaId)?.values() ?? [])
		if (names.has(folded)) return true
	return false
}

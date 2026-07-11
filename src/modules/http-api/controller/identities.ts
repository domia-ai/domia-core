import { generateUuid } from "@/utils"
import { env } from "@/config"
import {
	type DomiaType,
	getActiveDomias,
	getDomia,
	retireDomia,
	reactivateDomia,
	invalidateOwnDomia,
	getRedactedSatellitesForDomia,
	getActiveSatellites,
	upsertSatellite,
	deleteSatellite,
} from "@/modules/core"
import { publishIdentityState } from "@/modules/heartbeat-manager"
import { discoverEsphome } from "@/modules/satellite-discovery"
import {
	DEFAULT_SATELLITE_PORT,
	DEFAULT_SATELLITE_PROTOCOL,
	DEFAULT_SATELLITE_PORT_BY_PROTOCOL,
} from "@/db"
import { initialize, DEFAULT_CONFIG_VALUES } from "@/modules/config-engine"
import { reloadSubsystem } from "@/modules/config-apply"
import {
	bootHostedIdentity,
	teardownHostedIdentity,
} from "@/setups/hosted-identities"
import { reloadSatelliteClientsForDomia } from "@/setups/satellite-clients"
import { postIdentityBodySchema, postSatelliteBodySchema } from "../schemas"
import type { FastifyReply } from "fastify"

const slugifyDomiaKey = (name: string): string =>
	`DOMIA_${name
		.normalize("NFKD")
		.replace(/[^A-Za-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase()}`

const roleOf = (isHosted: boolean, isPrincipal: boolean): string =>
	isPrincipal ? "principal" : isHosted ? "hosted" : "peer"

export const handleGetIdentities = async () => {
	const domias = (await getActiveDomias()).filter(
		(domia): domia is DomiaType => !!domia,
	)
	return {
		identities: domias.map((domia) => {
			const isPrincipal = domia.domiaKey === env.DOMIA_KEY
			return {
				domiaKey: domia.domiaKey,
				name: domia.name,
				isHosted: domia.isHosted,
				isPrincipal,
				role: roleOf(domia.isHosted, isPrincipal),
			}
		}),
	}
}

export const handlePostIdentity = async (
	body: unknown,
	reply: FastifyReply,
) => {
	const parsed = postIdentityBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid identity body" })
	}
	const { name, domiaKey } = parsed.data
	const baseKey = domiaKey ?? slugifyDomiaKey(name)
	let key = baseKey
	const existing = await getDomia(key)
	if (existing) {
		if (!existing.isActive || !existing.isHosted) {
			await reactivateDomia(key)
			invalidateOwnDomia(key)
			const booted = await bootHostedIdentity(key)
			if (booted) await reloadSatelliteClientsForDomia(booted)
			await publishIdentityState(key)
			return {
				identity: { domiaKey: key, name: existing.name },
				restored: true,
			}
		}
		if (domiaKey) {
			return reply.code(409).send({ error: `identity already exists: ${key}` })
		}
		key = `${baseKey}_${generateUuid().slice(0, 6).toUpperCase()}`
	}
	await initialize(
		{ ...DEFAULT_CONFIG_VALUES, name, domiaKey: key },
		{ isHosted: true },
	)
	await bootHostedIdentity(key)
	await publishIdentityState(key)
	return { identity: { domiaKey: key, name } }
}

export const handleDeleteIdentity = async (
	domiaKey: string,
	reply: FastifyReply,
) => {
	if (domiaKey === env.DOMIA_KEY) {
		return reply
			.code(409)
			.send({ error: "principal identity cannot be removed" })
	}
	const existing = await getDomia(domiaKey)
	if (!existing) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	await retireDomia(domiaKey)
	invalidateOwnDomia(domiaKey)
	await publishIdentityState(domiaKey)
	await teardownHostedIdentity(domiaKey)
	return { removed: true }
}

export const handleDiscoverSatellites = async () => ({
	satellites: await discoverEsphome(),
})

export const handleGetSatellites = async (
	domiaKey: string | undefined,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	return { satellites: await getRedactedSatellitesForDomia(domia.id) }
}

export const handlePostSatellite = async (
	domiaKey: string | undefined,
	body: unknown,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({
			error: `satellites can only be bound to a hosted identity (room): ${domiaKey}`,
		})
	}
	const parsed = postSatelliteBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid satellite body" })
	}
	const {
		satelliteId,
		name,
		host,
		port,
		encryptionKey,
		protocol,
		livekitApiKey,
		livekitApiSecret,
		livekitRoom,
	} = parsed.data
	const boundElsewhere = (await getActiveSatellites()).find(
		(row) => row.satelliteId === satelliteId && row.domiaId !== domia.id,
	)
	if (boundElsewhere) {
		return reply.code(409).send({
			error: `satellite ${satelliteId} is already bound to another Domia (${boundElsewhere.domia.domiaKey})`,
		})
	}
	const resolvedProtocol = protocol ?? DEFAULT_SATELLITE_PROTOCOL
	await upsertSatellite(domia.id, {
		id: generateUuid(),
		satelliteId,
		name: name ?? null,
		host,
		port:
			port ??
			DEFAULT_SATELLITE_PORT_BY_PROTOCOL[resolvedProtocol] ??
			DEFAULT_SATELLITE_PORT,
		encryptionKey: encryptionKey ?? null,
		protocol: resolvedProtocol,
		livekitApiKey: livekitApiKey ?? null,
		livekitApiSecret: livekitApiSecret ?? null,
		livekitRoom: livekitRoom ?? null,
	})
	invalidateOwnDomia(domiaKey)
	const apply = await reloadSubsystem("satellites", domiaKey)
	return { bound: true, apply }
}

export const handleDeleteSatellite = async (
	domiaKey: string | undefined,
	satelliteId: string,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	await deleteSatellite(domia.id, satelliteId)
	invalidateOwnDomia(domiaKey)
	const apply = await reloadSubsystem("satellites", domiaKey)
	return { removed: true, apply }
}

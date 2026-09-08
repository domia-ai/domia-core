import { createHmac } from "crypto"

import { env } from "@/config"
import { DEFAULT_MESH_SECRET_GRACE_MS } from "@/db/constants"
import { canonicalJson } from "../canonical"
import { createMeshSecretRing, secretEquals } from "./ring"
import type { MeshSecretPostureType } from "./types"

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
const BEARER_PREFIX = "Bearer "

const ring = createMeshSecretRing({
	current: env.DOMIA_MESH_SECRET,
	next: env.DOMIA_MESH_SECRET_NEXT,
	graceMs: DEFAULT_MESH_SECRET_GRACE_MS,
})

export const setMeshAuthTunables = (domia: {
	meshSecretGraceMs: number
}): void => {
	ring.setGraceMs(domia.meshSecretGraceMs)
}

export const restartMeshSecretGrace = (): MeshSecretPostureType => {
	ring.restartGrace()
	return ring.posture()
}

export const endMeshSecretGrace = (): MeshSecretPostureType => {
	ring.endGrace()
	return ring.posture()
}

export const meshSecretPosture = (): MeshSecretPostureType => ring.posture()

export const isLoopbackAddress = (address: string | undefined): boolean =>
	address !== undefined && LOOPBACK_ADDRESSES.has(address)

export const isValidMeshBearer = (header: string | undefined): boolean =>
	header !== undefined &&
	header.startsWith(BEARER_PREFIX) &&
	ring.accepts(header.slice(BEARER_PREFIX.length))

export const isSigningMeshBearer = (header: string | undefined): boolean =>
	header !== undefined &&
	header.startsWith(BEARER_PREFIX) &&
	ring.isSigningSecret(header.slice(BEARER_PREFIX.length))

export const isValidMeshToken = (token: string | undefined): boolean =>
	ring.accepts(token)

export const meshBearerHeader = (): Record<string, string> => ({
	authorization: `Bearer ${ring.signingSecret()}`,
})

const hmacHex = (payload: Record<string, unknown>, secret: string): string =>
	createHmac("sha256", secret).update(canonicalJson(payload)).digest("hex")

export const signMeshPayload = (
	payload: Record<string, unknown>,
	secret: string = ring.signingSecret(),
): string => hmacHex(payload, secret)

export const verifyMeshSignature = (
	payload: Record<string, unknown>,
	signature: unknown,
	secret?: string,
): boolean => {
	if (typeof signature !== "string") return false
	const secrets = secret !== undefined ? [secret] : ring.acceptedSecrets()
	return secrets.some((s) => secretEquals(signature, hmacHex(payload, s)))
}

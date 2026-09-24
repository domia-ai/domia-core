import { canonicalJson } from "../canonical"
import { signMeshPayload, verifyMeshSignature } from "./mesh-auth"
import type {
	MintSatelliteTokenArgsType,
	MintedSatelliteTokenType,
	SatelliteTokenPayloadType,
	VerifySatelliteTokenArgsType,
} from "./types"

export const SATELLITE_TOKEN_TTL_MS = 120_000

const SATELLITE_TOKEN_VERSION = 1

const encodePayload = (payload: SatelliteTokenPayloadType): string =>
	Buffer.from(canonicalJson(payload)).toString("base64url")

const decodePayload = (encoded: string): SatelliteTokenPayloadType | null => {
	let parsed: unknown
	try {
		parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
	} catch {
		return null
	}
	if (typeof parsed !== "object" || parsed === null) return null
	const { v, domiaKey, satelliteId, exp } = parsed as Record<string, unknown>
	if (v !== SATELLITE_TOKEN_VERSION) return null
	if (typeof domiaKey !== "string" || domiaKey.length === 0) return null
	if (typeof satelliteId !== "string" || satelliteId.length === 0) return null
	if (typeof exp !== "number" || !Number.isFinite(exp)) return null
	return { v, domiaKey, satelliteId, exp }
}

export const mintSatelliteToken = ({
	domiaKey,
	satelliteId,
	ttlMs = SATELLITE_TOKEN_TTL_MS,
	now = Date.now(),
	secret,
}: MintSatelliteTokenArgsType): MintedSatelliteTokenType => {
	const payload: SatelliteTokenPayloadType = {
		v: SATELLITE_TOKEN_VERSION,
		domiaKey,
		satelliteId,
		exp: now + ttlMs,
	}
	return {
		token: `${encodePayload(payload)}.${signMeshPayload(payload, secret)}`,
		expiresAt: payload.exp,
	}
}

export const verifySatelliteToken = (
	token: string | undefined,
	{
		domiaKey,
		satelliteId,
		now = Date.now(),
		secret,
	}: VerifySatelliteTokenArgsType,
): boolean => {
	if (typeof token !== "string") return false
	const separator = token.indexOf(".")
	if (separator <= 0 || separator === token.length - 1) return false
	const payload = decodePayload(token.slice(0, separator))
	if (!payload) return false
	if (payload.domiaKey !== domiaKey || payload.satelliteId !== satelliteId)
		return false
	if (payload.exp <= now) return false
	return verifyMeshSignature(payload, token.slice(separator + 1), secret)
}

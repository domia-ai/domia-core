import { createHash, timingSafeEqual } from "crypto"

import type {
	MeshSecretPostureType,
	MeshSecretRingArgsType,
	MeshSecretRingType,
	MeshSecretSlotType,
} from "./types"

const FINGERPRINT_CHARS = 12

export const secretEquals = (
	candidate: string | undefined,
	expected: string,
): boolean => {
	if (candidate === undefined) return false
	const a = Buffer.from(candidate)
	const b = Buffer.from(expected)
	return a.length === b.length && timingSafeEqual(a, b)
}

export const secretFingerprint = (secret: string): string =>
	createHash("sha256").update(secret).digest("hex").slice(0, FINGERPRINT_CHARS)

export const createMeshSecretRing = ({
	current,
	next,
	graceMs,
	now = Date.now,
}: MeshSecretRingArgsType): MeshSecretRingType => {
	let grace = graceMs
	let graceStartedAt = now()

	const nextSecret = next !== undefined && next !== current ? next : null
	const rotating = nextSecret !== null
	const graceActive = (): boolean => rotating && now() < graceStartedAt + grace

	const signingSecret = (): string => nextSecret ?? current

	const acceptedSlots = (): MeshSecretSlotType[] => {
		if (!rotating) return ["current"]
		return graceActive() ? ["next", "current"] : ["next"]
	}

	const acceptedSecrets = (): string[] =>
		acceptedSlots().map((slot) =>
			slot === "next" ? (nextSecret ?? current) : current,
		)

	const accepts = (candidate: string | undefined): boolean =>
		acceptedSecrets().some((secret) => secretEquals(candidate, secret))

	const isSigningSecret = (candidate: string | undefined): boolean =>
		secretEquals(candidate, signingSecret())

	const posture = (): MeshSecretPostureType => ({
		rotating,
		signingWith: rotating ? "next" : "current",
		accepted: acceptedSlots(),
		graceMs: grace,
		graceEndsAt:
			rotating && graceActive()
				? new Date(graceStartedAt + grace).toISOString()
				: null,
		fingerprints: {
			current: secretFingerprint(current),
			next: nextSecret ? secretFingerprint(nextSecret) : null,
		},
	})

	return {
		signingSecret,
		acceptedSecrets,
		accepts,
		isSigningSecret,
		setGraceMs: (ms) => {
			grace = ms
		},
		restartGrace: () => {
			graceStartedAt = now()
		},
		endGrace: () => {
			graceStartedAt = Number.NEGATIVE_INFINITY
		},
		posture,
	}
}

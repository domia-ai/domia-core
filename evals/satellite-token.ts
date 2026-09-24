import { canonicalJson } from "@/utils"
import {
	SATELLITE_TOKEN_TTL_MS,
	createMeshSecretRing,
	mintSatelliteToken,
	signMeshPayload,
	verifySatelliteToken,
} from "@/utils/mesh-auth"

import { makeChecker } from "./lib"

const checker = makeChecker()

const SECRET_A = "mesh-secret-alpha-0123456789"
const SECRET_B = "mesh-secret-bravo-0123456789"
const NOW = 1_700_000_000_000
const DOMIA_KEY = "DOMIA_TOKEN"
const SATELLITE_ID = "sat-console-lab"

const encode = (payload: Record<string, unknown>): string =>
	Buffer.from(canonicalJson(payload)).toString("base64url")

const decode = (token: string): Record<string, unknown> =>
	JSON.parse(
		Buffer.from(token.slice(0, token.indexOf(".")), "base64url").toString(
			"utf8",
		),
	) as Record<string, unknown>

const mint = (
	overrides: {
		domiaKey?: string
		satelliteId?: string
		ttlMs?: number
		secret?: string
	} = {},
) =>
	mintSatelliteToken({
		domiaKey: overrides.domiaKey ?? DOMIA_KEY,
		satelliteId: overrides.satelliteId ?? SATELLITE_ID,
		ttlMs: overrides.ttlMs,
		now: NOW,
		secret: overrides.secret,
	})

const verify = (
	token: string | undefined,
	overrides: {
		domiaKey?: string
		satelliteId?: string
		now?: number
		secret?: string
	} = {},
): boolean =>
	verifySatelliteToken(token, {
		domiaKey: overrides.domiaKey ?? DOMIA_KEY,
		satelliteId: overrides.satelliteId ?? SATELLITE_ID,
		now: overrides.now ?? NOW,
		secret: overrides.secret,
	})

const shapeChecks = (): void => {
	console.log("\n== T1 token shape ==")
	const minted = mint({ secret: SECRET_A })
	const [encoded, signature, ...extra] = minted.token.split(".")
	checker.check(
		"token is exactly payload.signature",
		extra.length === 0 &&
			encoded.length > 0 &&
			/^[0-9a-f]{64}$/.test(signature),
		minted.token,
	)
	const payload = decode(minted.token)
	checker.check(
		"payload carries v/domiaKey/satelliteId/exp only",
		Object.keys(payload).sort().join(",") === "domiaKey,exp,satelliteId,v",
		JSON.stringify(payload),
	)
	checker.check(
		"payload is version 1 and bound to the identity + satellite",
		payload.v === 1 &&
			payload.domiaKey === DOMIA_KEY &&
			payload.satelliteId === SATELLITE_ID,
		JSON.stringify(payload),
	)
	checker.check(
		"expiresAt matches the payload exp",
		minted.expiresAt === NOW + SATELLITE_TOKEN_TTL_MS &&
			payload.exp === minted.expiresAt,
		`${minted.expiresAt}`,
	)
	checker.check(
		"token never embeds the mesh secret",
		!minted.token.includes(SECRET_A) && !encoded.includes("mesh-secret"),
	)
}

const roundTripChecks = (): void => {
	console.log("\n== T2 mint → verify ==")
	checker.check(
		"round trip with the node's own ring",
		verify(mint().token, { now: NOW + 1 }),
	)
	const minted = mint({ secret: SECRET_A })
	checker.check(
		"round trip with an explicit secret",
		verify(minted.token, { secret: SECRET_A }),
	)
	checker.check(
		"reject: verified against another secret",
		!verify(minted.token, { secret: SECRET_B }),
	)
	checker.check(
		"accept: one millisecond before expiry",
		verify(minted.token, { secret: SECRET_A, now: minted.expiresAt - 1 }),
	)
}

const scopeChecks = (): void => {
	console.log("\n== T3 scope binding ==")
	const minted = mint({ secret: SECRET_A })
	checker.check(
		"reject: another satelliteId",
		!verify(minted.token, { secret: SECRET_A, satelliteId: "sat-other" }),
	)
	checker.check(
		"reject: another domiaKey",
		!verify(minted.token, { secret: SECRET_A, domiaKey: "DOMIA_OTHER" }),
	)
	const foreign = mint({
		domiaKey: "DOMIA_OTHER",
		satelliteId: "sat-other",
		secret: SECRET_A,
	})
	checker.check(
		"reject: a token minted for another pair replayed on ours",
		!verify(foreign.token, { secret: SECRET_A }) &&
			verify(foreign.token, {
				secret: SECRET_A,
				domiaKey: "DOMIA_OTHER",
				satelliteId: "sat-other",
			}),
	)
}

const expiryChecks = (): void => {
	console.log("\n== T4 expiry ==")
	const minted = mint({ secret: SECRET_A })
	checker.check(
		"reject: exactly at exp",
		!verify(minted.token, { secret: SECRET_A, now: minted.expiresAt }),
	)
	checker.check(
		"reject: one second after exp",
		!verify(minted.token, { secret: SECRET_A, now: minted.expiresAt + 1000 }),
	)
	const short = mint({ ttlMs: 1_000, secret: SECRET_A })
	checker.check(
		"custom ttl honoured",
		short.expiresAt === NOW + 1_000 &&
			verify(short.token, { secret: SECRET_A, now: NOW + 999 }) &&
			!verify(short.token, { secret: SECRET_A, now: NOW + 1_000 }),
	)
}

const tamperChecks = (): void => {
	console.log("\n== T5 tampering ==")
	const minted = mint({ secret: SECRET_A })
	const signature = minted.token.slice(minted.token.indexOf(".") + 1)
	const payload = decode(minted.token)
	const swapped = `${encode({ ...payload, satelliteId: "sat-evil" })}.${signature}`
	checker.check(
		"reject: satelliteId swapped, signature kept",
		!verify(swapped, { secret: SECRET_A, satelliteId: "sat-evil" }),
	)
	const extended = `${encode({ ...payload, exp: NOW + 86_400_000 })}.${signature}`
	checker.check(
		"reject: exp extended, signature kept",
		!verify(extended, { secret: SECRET_A, now: NOW + 3_600_000 }),
	)
	const resigned = `${encode({ ...payload, satelliteId: "sat-evil" })}.${signMeshPayload(
		{ ...payload, satelliteId: "sat-evil" },
		SECRET_B,
	)}`
	checker.check(
		"reject: re-signed with a foreign secret",
		!verify(resigned, { secret: SECRET_A, satelliteId: "sat-evil" }),
	)
	checker.check(
		"reject: truncated signature",
		!verify(`${encode(payload)}.${signature.slice(0, 40)}`, {
			secret: SECRET_A,
		}),
	)
	checker.check(
		"reject: malformed tokens",
		[
			undefined,
			"",
			".",
			"no-dot-at-all",
			`${encode(payload)}.`,
			`.${signature}`,
			`not-base64url!!.${signature}`,
			`${Buffer.from("[]").toString("base64url")}.${signature}`,
			`${encode({ ...payload, v: 2 })}.${signature}`,
		].every((candidate) => !verify(candidate, { secret: SECRET_A })),
	)
	checker.check(
		"reject: payload without the version field",
		!verify(
			`${encode({
				domiaKey: DOMIA_KEY,
				satelliteId: SATELLITE_ID,
				exp: NOW + 1000,
			})}.${signature}`,
			{ secret: SECRET_A },
		),
	)
	checker.check(
		"accept: key order in the payload does not matter",
		verify(
			`${encode({
				exp: payload.exp,
				satelliteId: payload.satelliteId,
				domiaKey: payload.domiaKey,
				v: payload.v,
			})}.${signature}`,
			{ secret: SECRET_A },
		),
	)
}

const rotationChecks = (): void => {
	console.log("\n== T6 secret rotation grace ==")
	let clock = NOW
	const graceMs = 60_000
	const ring = createMeshSecretRing({
		current: SECRET_A,
		next: SECRET_B,
		graceMs,
		now: () => clock,
	})
	const acceptedByRing = (token: string, now: number): boolean =>
		ring.acceptedSecrets().some((secret) => verify(token, { secret, now }))

	const old = mintSatelliteToken({
		domiaKey: DOMIA_KEY,
		satelliteId: SATELLITE_ID,
		now: NOW,
		ttlMs: graceMs * 4,
		secret: SECRET_A,
	})
	const fresh = mintSatelliteToken({
		domiaKey: DOMIA_KEY,
		satelliteId: SATELLITE_ID,
		now: NOW,
		ttlMs: graceMs * 4,
		secret: ring.signingSecret(),
	})
	checker.check(
		"rotating ring signs new tokens with the next secret",
		ring.signingSecret() === SECRET_B,
	)
	checker.check(
		"in grace: a token signed with the previous secret is accepted",
		acceptedByRing(old.token, NOW + 1),
	)
	checker.check(
		"in grace: a token signed with the signing secret is accepted",
		acceptedByRing(fresh.token, NOW + 1),
	)
	clock += graceMs - 1
	checker.check(
		"grace edge: previous secret still accepted at t+grace-1",
		acceptedByRing(old.token, clock),
	)
	clock += 1
	checker.check(
		"after grace: the previous-secret token is rejected",
		!acceptedByRing(old.token, clock),
	)
	checker.check(
		"after grace: the signing-secret token is still accepted",
		acceptedByRing(fresh.token, clock),
	)
	checker.check(
		"after grace: expiry still wins over an accepted secret",
		!acceptedByRing(fresh.token, fresh.expiresAt),
	)
}

const main = (): void => {
	console.log("=== satellite-token (CORE-B scoped satellite tokens) ===")
	shapeChecks()
	roundTripChecks()
	scopeChecks()
	expiryChecks()
	tamperChecks()
	rotationChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

main()

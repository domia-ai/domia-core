import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { env } from "./lib/env"
import { meshHeaders } from "./lib/http"

type SnapshotFilesType = {
	config: Record<string, unknown>
	mind: Record<string, unknown>
	satellites: { satellites: Record<string, unknown>[] }
}

const PROVIDER_TOKEN_ENV = "DOMIA_PROVIDER_TOKEN"
const REDACTED = "__redacted__"

const satelliteKeyEnv = (satelliteId: string): string =>
	`DOMIA_SATELLITE_KEY_${satelliteId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`

const unredacted = (v: unknown): string | undefined =>
	typeof v === "string" && v.length > 0 && v !== REDACTED ? v : undefined

const argValue = (flag: string): string | undefined => {
	const idx = process.argv.indexOf(flag)
	return idx >= 0 ? process.argv[idx + 1] : undefined
}

const mode = process.argv[2]
const dir = argValue("--dir") ?? "evals/results/node-snapshot"
const base = env.EVAL_URL
const key = env.EVAL_DOMIA_KEY

const request = async <T>(
	method: "GET" | "POST" | "PATCH",
	path: string,
	body?: unknown,
): Promise<T> => {
	const sep = path.includes("?") ? "&" : "?"
	const res = await fetch(`${base}${path}${sep}domiaKey=${key}`, {
		method,
		headers: { "content-type": "application/json", ...meshHeaders() },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const text = await res.text()
	if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`)
	return (text ? JSON.parse(text) : {}) as T
}

const snapshot = async (): Promise<void> => {
	await mkdir(dir, { recursive: true })
	const files: SnapshotFilesType = {
		config: await request("GET", "/config"),
		mind: await request("GET", "/mind"),
		satellites: await request("GET", "/satellites"),
	}
	for (const [name, data] of Object.entries(files))
		await writeFile(
			join(dir, `${key}-${name}.json`),
			JSON.stringify(data, null, 2),
		)
	console.log(`📸 snapshot of ${key} written to ${dir}/`)
}

const withProviderTokens = (
	bundle: Record<string, unknown>,
): Record<string, unknown> => {
	const providers = bundle.skillProviders
	if (!Array.isArray(providers)) return bundle
	const token = process.env[PROVIDER_TOKEN_ENV]?.trim()
	const restored = providers.map((provider: Record<string, unknown>) => {
		const auth = provider.auth as Record<string, unknown> | null | undefined
		if (!auth || auth.token || !token) return provider
		return { ...provider, auth: { ...auth, token } }
	})
	return { ...bundle, skillProviders: restored }
}

const restore = async (): Promise<void> => {
	const read = async <T>(name: string): Promise<T> =>
		JSON.parse(await readFile(join(dir, `${key}-${name}.json`), "utf8")) as T
	const configFile = await read<{ config: Record<string, unknown> }>("config")
	const bundle = withProviderTokens(configFile.config)
	await request("POST", "/config", bundle)
	console.log(`✅ config restored (${Object.keys(bundle).length} sections)`)
	const sats = await read<SnapshotFilesType["satellites"]>("satellites")
	for (const sat of sats.satellites) {
		const satelliteId = String(sat.satelliteId)
		const envName = satelliteKeyEnv(satelliteId)
		const encryptionKey =
			unredacted(process.env[envName]?.trim()) ?? unredacted(sat.encryptionKey)
		if (!encryptionKey && sat.encryptionKey)
			console.warn(
				`⚠️ satellite ${satelliteId} had an encryption key but no ${envName} provided — restoring without one`,
			)
		const body: Record<string, unknown> = {
			satelliteId: sat.satelliteId,
			name: sat.name ?? undefined,
			host: sat.host,
			port: sat.port ?? undefined,
			encryptionKey,
			livekitApiSecret: unredacted(sat.livekitApiSecret),
			protocol: sat.protocol ?? undefined,
		}
		await request("POST", "/satellites", body)
		const wakeWords = sat.desiredWakeWords
		if (Array.isArray(wakeWords) && wakeWords.length > 0)
			await request(
				"POST",
				`/satellites/${String(sat.satelliteId)}/wake-words`,
				{
					wakeWords,
				},
			)
		if (sat.followUpEnabled === true)
			await request("PATCH", `/satellites/${satelliteId}/follow-up`, {
				enabled: true,
			})
		if (typeof sat.desiredVolume === "number")
			await request("PATCH", `/satellites/${satelliteId}/volume`, {
				volume: sat.desiredVolume,
			})
		console.log(
			`✅ satellite restored: ${satelliteId}${sat.followUpEnabled === true ? " (follow-up on)" : ""}`,
		)
	}
	const mind = await read<Record<string, unknown>>("mind")
	await request("POST", "/mind/import", mind)
	console.log("✅ mind imported")
}

const main = async (): Promise<void> => {
	if (mode === "snapshot") await snapshot()
	else if (mode === "restore") await restore()
	else {
		console.error(
			"usage: evals/node-snapshot.ts snapshot|restore [--dir path]  (EVAL_URL, EVAL_DOMIA_KEY, DOMIA_PROVIDER_TOKEN, DOMIA_SATELLITE_KEY_<SATELLITEID> per satellite)",
		)
		process.exit(2)
	}
}

void main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
})

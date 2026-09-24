import type {
	MindBundleType,
	MindSectionDataType,
	MindSectionType,
} from "@/modules/mind-transfer"

import { env } from "./lib/env"
import {
	execWrite,
	makeChecker,
	meshHeaders,
	waitForHealth,
	queryOne,
} from "./lib"

const TRANSFERRED_SECTIONS: MindSectionType[] = [
	"memory_fact",
	"fact_evidence",
	"knowledge_entry",
	"memory_episode",
	"emotion_event",
]

const TRANSFER_TARGET_KEY = "DOMIA_EVAL_MIND_TRANSFER"

const SATELLITE_SECRET_COLUMNS = [
	"encryption_key",
	"livekit_api_key",
	"livekit_api_secret",
]

const EVAL_PROVIDER_ID = "eval-mt-provider"
const EVAL_PROVIDER_TOKEN = "eval-secret-token"
const EVAL_SATELLITE_ID = "eval-mt-satellite"
const EVAL_SATELLITE_SECRETS = {
	encryption_key: "eval-encryption-key",
	livekit_api_key: "eval-lk-key",
	livekit_api_secret: "eval-lk-secret",
}
const EVAL_PROFILE_ID = "eval-mt-profile"
const EVAL_FACT_ID = "eval-mt-fact"

const request = (path: string, init: RequestInit = {}): Promise<Response> =>
	fetch(`${env.EVAL_URL}${path}`, {
		...init,
		headers: {
			...(init.body === undefined
				? {}
				: { "content-type": "application/json" }),
			...meshHeaders(),
		},
	})

const postJson = (path: string, body: unknown): Promise<Response> =>
	request(path, { method: "POST", body: JSON.stringify(body) })

const del = (path: string): Promise<Response> =>
	request(path, { method: "DELETE" })

const rowCount = (section: MindSectionDataType | undefined): number =>
	section?.rows.length ?? 0

const cells = (
	section: MindSectionDataType | undefined,
	column: string,
): unknown[] => {
	if (!section) return []
	const idx = section.columns.indexOf(column)
	return idx < 0 ? [] : section.rows.map((r) => r[idx])
}

const tableCount = (table: string, domiaId: string): number =>
	queryOne<{ n: number }>(
		`SELECT count(*) AS n FROM ${table} WHERE domia_id = ?`,
		[domiaId],
	)?.n ?? 0

const evidenceCount = (domiaId: string): number =>
	queryOne<{ n: number }>(
		"SELECT count(*) AS n FROM fact_evidence WHERE fact_id IN (SELECT id FROM memory_fact WHERE domia_id = ?)",
		[domiaId],
	)?.n ?? 0

const domiaIdOf = (domiaKey: string): string | undefined =>
	queryOne<{ id: string }>("SELECT id FROM domia WHERE domia_key = ?", [
		domiaKey,
	])?.id

const importStatus = async (
	domiaKey: string,
	body: unknown,
): Promise<number> => {
	const res = await postJson(`/mind/import?domiaKey=${domiaKey}`, body)
	return res.status
}

type SectionReport = Partial<
	Record<string, { inserted: number; updated: number; skipped: number }>
>

const importReport = async (
	domiaKey: string,
	body: unknown,
): Promise<{ status: number; sections: SectionReport; code?: string }> => {
	const res = await postJson(`/mind/import?domiaKey=${domiaKey}`, body)
	const json = (await res.json()) as {
		report?: { sections: SectionReport }
		code?: string
	}
	return {
		status: res.status,
		sections: json.report?.sections ?? {},
		code: json.code,
	}
}

const bundleOf = (
	sourceDomiaKey: string,
	sections: MindBundleType["sections"],
): MindBundleType => ({
	version: 1,
	exportedAt: new Date().toISOString(),
	sourceDomiaKey,
	sections,
})

const factBundle = (
	sourceDomiaKey: string,
	domiaId: string,
	confidence: number,
): MindBundleType =>
	bundleOf(sourceDomiaKey, {
		memory_fact: {
			columns: [
				"id",
				"domia_id",
				"subject",
				"relation",
				"value",
				"value_key",
				"confidence",
			],
			rows: [
				[EVAL_FACT_ID, domiaId, "eval-user", "likes", "tea", "tea", confidence],
			],
		},
	})

const profileBundle = (
	sourceDomiaKey: string,
	domiaId: string,
	isActive: 0 | 1,
): MindBundleType =>
	bundleOf(sourceDomiaKey, {
		character_profile: {
			columns: ["id", "domia_id", "name", "is_active"],
			rows: [[EVAL_PROFILE_ID, domiaId, "Eval Profile", isActive]],
		},
	})

const seedSecretRows = (domiaId: string): void => {
	const now = new Date().toISOString()
	execWrite(
		"INSERT INTO skill_provider (id, name, is_active, domia_id, protocol, type, url, auth, created_at, updated_at) VALUES (?, ?, 0, ?, 'mcp', 'http', 'http://127.0.0.1:9/mcp', ?, ?, ?)",
		[
			EVAL_PROVIDER_ID,
			"eval-provider",
			domiaId,
			JSON.stringify({ kind: "bearer", token: EVAL_PROVIDER_TOKEN }),
			now,
			now,
		],
	)
	execWrite(
		"INSERT INTO satellite_config (id, domia_id, satellite_id, host, encryption_key, livekit_api_key, livekit_api_secret, is_active, created_at, updated_at) VALUES (?, ?, ?, '127.0.0.1', ?, ?, ?, 0, ?, ?)",
		[
			EVAL_SATELLITE_ID,
			domiaId,
			EVAL_SATELLITE_ID,
			EVAL_SATELLITE_SECRETS.encryption_key,
			EVAL_SATELLITE_SECRETS.livekit_api_key,
			EVAL_SATELLITE_SECRETS.livekit_api_secret,
			now,
			now,
		],
	)
}

const providerToken = (): string | undefined => {
	const raw = queryOne<{ auth: string | null }>(
		"SELECT auth FROM skill_provider WHERE id = ?",
		[EVAL_PROVIDER_ID],
	)?.auth
	if (!raw) return undefined
	return (JSON.parse(raw) as { token?: string }).token
}

const satelliteSecrets = (): Record<string, string | null> =>
	queryOne<Record<string, string | null>>(
		"SELECT encryption_key, livekit_api_key, livekit_api_secret FROM satellite_config WHERE id = ?",
		[EVAL_SATELLITE_ID],
	) ?? {}

const builtinProviderCount = (domiaId: string): number =>
	queryOne<{ n: number }>(
		"SELECT count(*) AS n FROM skill_provider WHERE domia_id = ? AND protocol = 'builtin'",
		[domiaId],
	)?.n ?? 0

const activeProfiles = (domiaId: string): string[] =>
	queryOne<{ ids: string | null }>(
		"SELECT group_concat(id) AS ids FROM character_profile WHERE domia_id = ? AND is_active = 1",
		[domiaId],
	)?.ids?.split(",") ?? []

const factConfidence = (): number | undefined =>
	queryOne<{ confidence: number }>(
		"SELECT confidence FROM memory_fact WHERE id = ?",
		[EVAL_FACT_ID],
	)?.confidence

const removeSeededRows = (domiaId: string, originalActive: string[]): void => {
	for (const id of originalActive)
		execWrite("UPDATE character_profile SET is_active = 1 WHERE id = ?", [id])
	execWrite("DELETE FROM character_profile WHERE id = ?", [EVAL_PROFILE_ID])
	execWrite("DELETE FROM skill_provider WHERE id = ? AND domia_id = ?", [
		EVAL_PROVIDER_ID,
		domiaId,
	])
	execWrite("DELETE FROM satellite_config WHERE id = ? AND domia_id = ?", [
		EVAL_SATELLITE_ID,
		domiaId,
	])
	execWrite("DELETE FROM fact_evidence WHERE fact_id = ?", [EVAL_FACT_ID])
	execWrite("DELETE FROM memory_fact WHERE id = ?", [EVAL_FACT_ID])
}

const main = async (): Promise<void> => {
	const checker = makeChecker()
	if (!(await waitForHealth())) {
		console.error(`❌ no node answers at ${env.EVAL_URL}`)
		process.exit(2)
	}
	const key = env.EVAL_DOMIA_KEY

	const exportRes = await request(`/mind/export?domiaKey=${key}`)
	checker.check(
		"GET /mind/export answers 200",
		exportRes.ok,
		`got ${exportRes.status}`,
	)
	const bundle = ((await exportRes.json()) as { bundle: MindBundleType }).bundle
	const meta = bundle as unknown as {
		version: number
		exportedAt: string
		sourceDomiaKey: string
	}
	checker.check(
		"bundle is version 1 and names its source identity",
		meta.version === 1 &&
			meta.sourceDomiaKey === key &&
			meta.exportedAt.length > 0,
		JSON.stringify({ version: meta.version, source: meta.sourceDomiaKey }),
	)
	checker.check(
		"bundle carries every mind section",
		Object.keys(bundle.sections).length >= TRANSFERRED_SECTIONS.length,
		Object.keys(bundle.sections).join(","),
	)

	const providers = bundle.sections.skill_provider
	checker.check(
		"exported providers never carry credentials",
		cells(providers, "auth").every((v) => v === null),
		JSON.stringify(cells(providers, "auth")),
	)
	checker.check(
		"the builtin provider is never exported",
		!cells(providers, "protocol").includes("builtin"),
		JSON.stringify(cells(providers, "protocol")),
	)
	const satellites = bundle.sections.satellite_config
	checker.check(
		"exported satellites never carry encryption or LiveKit secrets",
		SATELLITE_SECRET_COLUMNS.every((c) =>
			cells(satellites, c).every((v) => v === null),
		),
		SATELLITE_SECRET_COLUMNS.map(
			(c) => `${c}=${JSON.stringify(cells(satellites, c))}`,
		).join(" "),
	)

	const partialRes = await request(
		`/mind/export?domiaKey=${key}&sections=memory_fact,knowledge_entry`,
	)
	const partial = ((await partialRes.json()) as { bundle: MindBundleType })
		.bundle
	checker.check(
		"sections= narrows the export",
		Object.keys(partial.sections).sort().join(",") ===
			"knowledge_entry,memory_fact",
		Object.keys(partial.sections).join(","),
	)
	const unknownSectionRes = await request(
		`/mind/export?domiaKey=${key}&sections=not_a_table`,
	)
	checker.check(
		"an unknown export section is rejected with 400",
		unknownSectionRes.status === 400,
		`got ${unknownSectionRes.status}`,
	)

	const tenantKey = TRANSFER_TARGET_KEY
	await del(`/identities/${tenantKey}`)
	const created = await postJson("/identities", {
		name: "Eval Mind Transfer",
		domiaKey: tenantKey,
	})
	checker.check(
		"POST /identities creates the transfer target",
		created.ok,
		`got ${created.status}: ${await created.clone().text()}`,
	)
	const seededTenantId = domiaIdOf(tenantKey)
	const originalActiveProfiles = seededTenantId
		? activeProfiles(seededTenantId)
		: []

	try {
		checker.check(
			"a bundle with an unsupported version is rejected with 400",
			(await importStatus(tenantKey, {
				bundle: { ...bundle, version: 2 },
			})) === 400,
		)
		checker.check(
			"a bundle carrying a foreign section key is rejected with 400",
			(await importStatus(tenantKey, {
				bundle: {
					...bundle,
					sections: {
						...bundle.sections,
						interaction_trace: { columns: ["id"], rows: [] },
					},
				},
			})) === 400,
		)
		checker.check(
			"an unknown requested section is rejected with 400",
			(await importStatus(tenantKey, {
				bundle,
				sections: ["not_a_table"],
			})) === 400,
		)
		checker.check(
			"a bundle whose rows do not match its columns is rejected with 400",
			(await importStatus(tenantKey, {
				bundle: {
					...bundle,
					sections: {
						knowledge_entry: { columns: ["id", "domia_id"], rows: [["only"]] },
					},
				},
			})) === 400,
		)

		const tenantId = domiaIdOf(tenantKey)
		checker.check("the transfer target exists in the DB", Boolean(tenantId))
		if (!tenantId) throw new Error("transfer target has no domia row")

		const mergeRes = await postJson(`/mind/import?domiaKey=${tenantKey}`, {
			bundle,
			mode: "merge",
			sections: TRANSFERRED_SECTIONS,
		})
		checker.check(
			"POST /mind/import merges the bundle",
			mergeRes.ok,
			`got ${mergeRes.status}: ${await mergeRes.clone().text()}`,
		)

		const expected = {
			memory_fact: rowCount(bundle.sections.memory_fact),
			knowledge_entry: rowCount(bundle.sections.knowledge_entry),
			memory_episode: rowCount(bundle.sections.memory_episode),
			emotion_event: rowCount(bundle.sections.emotion_event),
			fact_evidence: rowCount(bundle.sections.fact_evidence),
		}
		const actual = {
			memory_fact: tableCount("memory_fact", tenantId),
			knowledge_entry: tableCount("knowledge_entry", tenantId),
			memory_episode: tableCount("memory_episode", tenantId),
			emotion_event: tableCount("emotion_event", tenantId),
			fact_evidence: evidenceCount(tenantId),
		}
		for (const section of Object.keys(expected) as (keyof typeof expected)[])
			checker.check(
				`${section} count matches the bundle after import`,
				actual[section] === expected[section],
				`expected ${expected[section]}, got ${actual[section]}`,
			)

		const replaceRes = await postJson(`/mind/import?domiaKey=${tenantKey}`, {
			bundle,
			mode: "replace",
			sections: TRANSFERRED_SECTIONS,
		})
		checker.check(
			"POST /mind/import replaces without duplicating",
			replaceRes.ok,
			`got ${replaceRes.status}: ${await replaceRes.clone().text()}`,
		)
		checker.check(
			"replace leaves the same row counts",
			tableCount("memory_fact", tenantId) === expected.memory_fact &&
				tableCount("knowledge_entry", tenantId) === expected.knowledge_entry &&
				tableCount("memory_episode", tenantId) === expected.memory_episode,
			`${tableCount("memory_fact", tenantId)}/${tableCount("knowledge_entry", tenantId)}/${tableCount("memory_episode", tenantId)}`,
		)

		const sourceId = domiaIdOf(key)
		checker.check(
			"the source identity keeps its own rows untouched",
			sourceId !== undefined &&
				tableCount("memory_fact", sourceId) === expected.memory_fact,
			`source=${sourceId ? tableCount("memory_fact", sourceId) : "?"} expected=${expected.memory_fact}`,
		)

		seedSecretRows(tenantId)
		const secretsExportRes = await request(
			`/mind/export?domiaKey=${tenantKey}&sections=skill_provider,satellite_config`,
		)
		const redacted = (
			(await secretsExportRes.json()) as { bundle: MindBundleType }
		).bundle
		const secretsMerge = await importReport(tenantKey, {
			bundle: redacted,
			mode: "merge",
		})
		checker.check(
			"merging a redacted bundle over live secrets answers 200",
			secretsMerge.status === 200,
			`got ${secretsMerge.status}`,
		)
		checker.check(
			"a redacted provider row matches its live row instead of updating it",
			secretsMerge.sections.skill_provider?.updated === 0 &&
				secretsMerge.sections.satellite_config?.updated === 0,
			JSON.stringify(secretsMerge.sections),
		)
		checker.check(
			"merge keeps the provider auth token",
			providerToken() === EVAL_PROVIDER_TOKEN,
			`token=${providerToken()}`,
		)
		const keptSecrets = satelliteSecrets()
		checker.check(
			"merge keeps the satellite encryption and LiveKit secrets",
			SATELLITE_SECRET_COLUMNS.every(
				(c) =>
					keptSecrets[c] ===
					EVAL_SATELLITE_SECRETS[c as keyof typeof EVAL_SATELLITE_SECRETS],
			),
			JSON.stringify(keptSecrets),
		)

		const before = {
			memory_fact: tableCount("memory_fact", tenantId),
			memory_episode: tableCount("memory_episode", tenantId),
			emotion_event: tableCount("emotion_event", tenantId),
			satellite_config: tableCount("satellite_config", tenantId),
			skill_provider: tableCount("skill_provider", tenantId),
			character_profile: tableCount("character_profile", tenantId),
		}
		const oneSection = await importReport(tenantKey, {
			bundle: bundleOf(key, {
				knowledge_entry: bundle.sections.knowledge_entry ?? {
					columns: ["id"],
					rows: [],
				},
			}),
			mode: "replace",
		})
		checker.check(
			"replace with a one-section bundle answers 200",
			oneSection.status === 200,
			`got ${oneSection.status}`,
		)
		const after = {
			memory_fact: tableCount("memory_fact", tenantId),
			memory_episode: tableCount("memory_episode", tenantId),
			emotion_event: tableCount("emotion_event", tenantId),
			satellite_config: tableCount("satellite_config", tenantId),
			skill_provider: tableCount("skill_provider", tenantId),
			character_profile: tableCount("character_profile", tenantId),
		}
		checker.check(
			"replace only clears the sections the bundle carries",
			JSON.stringify(before) === JSON.stringify(after) &&
				oneSection.sections.memory_fact === undefined,
			`before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
		)
		checker.check(
			"replace keeps the builtin provider row",
			builtinProviderCount(tenantId) === 1,
			`builtin rows=${builtinProviderCount(tenantId)}`,
		)
		const fullReplace = await importReport(tenantKey, {
			bundle: bundleOf(key, {
				skill_provider: redacted.sections.skill_provider ?? {
					columns: ["id"],
					rows: [],
				},
			}),
			mode: "replace",
		})
		checker.check(
			"replacing the provider section keeps exactly one builtin provider",
			fullReplace.status === 200 && builtinProviderCount(tenantId) === 1,
			`status=${fullReplace.status} builtin rows=${builtinProviderCount(tenantId)}`,
		)

		const seededFact = await importReport(tenantKey, {
			bundle: factBundle(key, tenantId, 0.9),
			mode: "merge",
		})
		checker.check(
			"a fresh fact merges in",
			seededFact.status === 200 &&
				seededFact.sections.memory_fact?.inserted === 1,
			JSON.stringify(seededFact),
		)
		const skipped = await importReport(tenantKey, {
			bundle: factBundle(key, tenantId, 0.4),
			mode: "merge",
			onConflict: "skip",
		})
		checker.check(
			"a conflicting fact under onConflict=skip succeeds and reports skipped",
			skipped.status === 200 &&
				skipped.sections.memory_fact?.skipped === 1 &&
				factConfidence() === 0.9,
			`status=${skipped.status} report=${JSON.stringify(skipped.sections)} confidence=${factConfidence()}`,
		)
		const defaulted = await importReport(tenantKey, {
			bundle: factBundle(key, tenantId, 0.4),
			mode: "merge",
		})
		checker.check(
			"onConflict defaults to skip",
			defaulted.status === 200 && defaulted.sections.memory_fact?.skipped === 1,
			`status=${defaulted.status} report=${JSON.stringify(defaulted.sections)}`,
		)
		const failed = await importReport(tenantKey, {
			bundle: factBundle(key, tenantId, 0.4),
			mode: "merge",
			onConflict: "fail",
		})
		checker.check(
			"a conflicting fact under onConflict=fail returns the 409 conflict",
			failed.status === 409 && failed.code === "MIND_TRANSFER/IMPORT_CONFLICT",
			`status=${failed.status} code=${failed.code}`,
		)
		const overwritten = await importReport(tenantKey, {
			bundle: factBundle(key, tenantId, 0.4),
			mode: "merge",
			onConflict: "overwrite",
		})
		checker.check(
			"a conflicting fact under onConflict=overwrite updates the row",
			overwritten.status === 200 &&
				overwritten.sections.memory_fact?.updated === 1 &&
				factConfidence() === 0.4,
			`status=${overwritten.status} confidence=${factConfidence()}`,
		)
		checker.check(
			"an unknown onConflict value is rejected with 400",
			(await importStatus(tenantKey, {
				bundle: factBundle(key, tenantId, 0.4),
				onConflict: "maybe",
			})) === 400,
		)

		const inactiveProfile = await importReport(tenantKey, {
			bundle: profileBundle(key, tenantId, 0),
			mode: "merge",
		})
		checker.check(
			"an inactive profile merges without touching the active one",
			inactiveProfile.status === 200 &&
				activeProfiles(tenantId).join(",") === originalActiveProfiles.join(","),
			`status=${inactiveProfile.status} active=${activeProfiles(tenantId).join(",")}`,
		)
		const activeProfile = await importReport(tenantKey, {
			bundle: profileBundle(key, tenantId, 1),
			mode: "merge",
		})
		checker.check(
			"activating an imported profile leaves exactly one active profile",
			activeProfile.status === 200 &&
				activeProfiles(tenantId).join(",") === EVAL_PROFILE_ID,
			`status=${activeProfile.status} active=${activeProfiles(tenantId).join(",")}`,
		)
	} finally {
		if (seededTenantId) removeSeededRows(seededTenantId, originalActiveProfiles)
		await del(`/identity-data?domiaKey=${tenantKey}`)
		await del(`/identities/${tenantKey}`)
	}

	console.log(
		`\nmind-transfer: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	if (checker.failCount() > 0) process.exit(1)
}

void main()

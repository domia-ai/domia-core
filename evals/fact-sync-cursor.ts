import { env, waitForHealth, execWrite, queryOne } from "./lib"
import type { SyncPageType } from "./types"

const SENTINELS = 25
const PAGE_LIMIT = 10
const MAX_PAGES = 20
const SHARED_TS = "2001-01-01 00:00:00.000"
const VALUE_PREFIX = "cursor-probe-"

const fetchSyncPage = async (
	factsSince: string,
	factsId: string,
): Promise<SyncPageType> => {
	const url = `${env.EVAL_URL}/sync?limit=${PAGE_LIMIT}&domiaKey=${encodeURIComponent(env.EVAL_DOMIA_KEY)}&factsSince=${encodeURIComponent(factsSince)}&factsId=${encodeURIComponent(factsId)}`
	const res = await fetch(url)
	if (!res.ok) throw new Error(`sync ${res.status}`)
	return (await res.json()) as SyncPageType
}

const main = async (): Promise<void> => {
	await waitForHealth()
	const domiaId = queryOne<{ id: string }>(
		"SELECT id FROM domia WHERE domia_key = ?",
		[env.EVAL_DOMIA_KEY],
	)?.id
	if (!domiaId) throw new Error(`no domia row for ${env.EVAL_DOMIA_KEY}`)

	execWrite("DELETE FROM memory_fact WHERE value LIKE ?", [`${VALUE_PREFIX}%`])
	for (let i = 0; i < SENTINELS; i++) {
		execWrite(
			`INSERT INTO memory_fact (id, domia_id, subject, relation, value, value_key, confidence, kind, created_at, updated_at)
			 VALUES (?, ?, 'the user', 'likes', ?, ?, 0.7, 'preference', ?, ?)`,
			[
				`cursor-probe-${String(i).padStart(3, "0")}`,
				domiaId,
				`${VALUE_PREFIX}${i}`,
				`${VALUE_PREFIX}${i}`,
				SHARED_TS,
				SHARED_TS,
			],
		)
	}

	const seen = new Set<string>()
	const sentinelsSeen = new Set<string>()
	let cursor = { since: "", id: "" }
	let pages = 0
	let duplicates = 0
	let stalled = false
	for (; pages < MAX_PAGES; pages++) {
		const page = await fetchSyncPage(cursor.since, cursor.id)
		for (const fact of page.facts) {
			if (seen.has(fact.id)) duplicates++
			seen.add(fact.id)
			if (fact.value.startsWith(VALUE_PREFIX)) sentinelsSeen.add(fact.id)
		}
		if (!page.nextFactsCursor) break
		if (
			page.nextFactsCursor.since === cursor.since &&
			page.nextFactsCursor.id === cursor.id
		) {
			stalled = true
			break
		}
		cursor = page.nextFactsCursor
		if (page.facts.length < PAGE_LIMIT) break
	}

	execWrite("DELETE FROM memory_fact WHERE value LIKE ?", [`${VALUE_PREFIX}%`])

	const checks: [string, boolean, string][] = [
		[
			"all same-timestamp sentinels collected",
			sentinelsSeen.size === SENTINELS,
			`${sentinelsSeen.size}/${SENTINELS}`,
		],
		["no duplicate facts across pages", duplicates === 0, `${duplicates} dups`],
		["cursor never stalled on a full page", !stalled, `stalled=${stalled}`],
		[
			"completed within page budget",
			pages < MAX_PAGES,
			`${pages + 1}/${MAX_PAGES} pages`,
		],
	]
	let failed = 0
	for (const [name, ok, detail] of checks) {
		console.log(`${ok ? "✅" : "❌"} ${name} (${detail})`)
		if (!ok) failed++
	}
	console.log(
		`${checks.length - failed}/${checks.length} fact-sync-cursor checks passed`,
	)
	if (failed) process.exit(1)
}

void main()

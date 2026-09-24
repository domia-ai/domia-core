import { env, waitForHealth, execWrite, queryOne } from "./lib"
import { meshHeaders } from "./lib/http"
import type {
	SyncStreamsPageType,
	SyncStreamCursorType,
	SyncKeysetStreamType,
} from "./types"

const SENTINELS = 25
const PAGE_LIMIT = 10
const MAX_PAGES = 20
const SHARED_TS = "2001-01-02 00:00:00.000"
const ID_PREFIX = "sync-streams-probe-"
const FACT_ID = `${ID_PREFIX}fact`

const STREAMS: SyncKeysetStreamType[] = [
	{
		name: "tool_run",
		rows: (page) => page.toolRuns,
		next: (page) => page.nextToolCursor,
		params: (c) => ({ toolSince: c.since, toolId: c.id }),
	},
	{
		name: "memory_episode",
		rows: (page) => page.memoryEpisodes,
		next: (page) => page.nextEpisodeCursor,
		params: (c) => ({ episodeSince: c.since, episodeId: c.id }),
	},
	{
		name: "knowledge_entry",
		rows: (page) => page.knowledgeEntries,
		next: (page) => page.nextKnowledgeCursor,
		params: (c) => ({ knowledgeSince: c.since, knowledgeId: c.id }),
	},
	{
		name: "voice_feel_adjustment",
		rows: (page) => page.voiceFeelAdjustments,
		next: (page) => page.nextVoiceFeelCursor,
		params: (c) => ({ voiceFeelSince: c.since, voiceFeelId: c.id }),
	},
	{
		name: "fact_evidence",
		rows: (page) => page.factEvidence,
		next: (page) => page.nextEvidenceCursor,
		params: (c) => ({ evidenceSince: c.since, evidenceId: c.id }),
	},
]

const cleanUp = (): void => {
	execWrite("DELETE FROM tool_run WHERE id LIKE ?", [`${ID_PREFIX}%`])
	execWrite("DELETE FROM memory_episode WHERE id LIKE ?", [`${ID_PREFIX}%`])
	execWrite("DELETE FROM knowledge_entry WHERE id LIKE ?", [`${ID_PREFIX}%`])
	execWrite("DELETE FROM voice_feel_adjustment WHERE id LIKE ?", [
		`${ID_PREFIX}%`,
	])
	execWrite("DELETE FROM fact_evidence WHERE id LIKE ?", [`${ID_PREFIX}%`])
	execWrite("DELETE FROM memory_fact WHERE id LIKE ?", [`${ID_PREFIX}%`])
}

const seed = (domiaId: string): void => {
	execWrite(
		`INSERT INTO memory_fact (id, domia_id, subject, relation, value, value_key, valid_until, created_at, updated_at)
		 VALUES (?, ?, 'sync-streams-probe', 'probes', 'keyset', 'keyset', ?, ?, ?)`,
		[FACT_ID, domiaId, SHARED_TS, SHARED_TS, SHARED_TS],
	)
	for (let i = 0; i < SENTINELS; i++) {
		const suffix = String(i).padStart(3, "0")
		const id = `${ID_PREFIX}${suffix}`
		execWrite(
			`INSERT INTO tool_run (id, domia_id, interaction_id, tool, provider_slug, routine_slug, step_index, args_hash, status, created_at)
			 VALUES (?, ?, ?, 'domia__Time', 'domia', 'sync_streams_probe', ?, 'probe', 'ok', ?)`,
			[id, domiaId, `${ID_PREFIX}interaction`, i, SHARED_TS],
		)
		execWrite(
			`INSERT INTO memory_episode (id, domia_id, session_id, summary, created_at)
			 VALUES (?, ?, ?, ?, ?)`,
			[
				id,
				domiaId,
				`${ID_PREFIX}session`,
				`sync streams probe ${i}`,
				SHARED_TS,
			],
		)
		execWrite(
			`INSERT INTO knowledge_entry (id, domia_id, title, content, is_active, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 0, ?, ?)`,
			[id, domiaId, `sync streams probe ${i}`, "probe", SHARED_TS, SHARED_TS],
		)
		execWrite(
			`INSERT INTO voice_feel_adjustment (id, domia_id, rule, section, field, from_value, to_value, sample_size, confidence, created_at)
			 VALUES (?, ?, 'sync_streams_probe', 'wakeWord', 'vadThreshold', 0.5, 0.5, 1, 0, ?)`,
			[id, domiaId, SHARED_TS],
		)
		execWrite(
			`INSERT INTO fact_evidence (id, fact_id, source_interaction_id, created_at)
			 VALUES (?, ?, ?, ?)`,
			[id, FACT_ID, `${ID_PREFIX}interaction-${suffix}`, SHARED_TS],
		)
	}
}

const fetchPage = async (
	cursors: SyncStreamCursorType[],
): Promise<SyncStreamsPageType> => {
	const params = new URLSearchParams({
		limit: String(PAGE_LIMIT),
		domiaKey: env.EVAL_DOMIA_KEY,
	})
	STREAMS.forEach((stream, k) => {
		for (const [key, value] of Object.entries(stream.params(cursors[k])))
			params.set(key, value)
	})
	const res = await fetch(`${env.EVAL_URL}/sync?${params.toString()}`, {
		headers: meshHeaders(),
	})
	if (!res.ok) throw new Error(`sync ${res.status}`)
	return (await res.json()) as SyncStreamsPageType
}

const sameCursor = (
	a: SyncStreamCursorType | null,
	b: SyncStreamCursorType,
): boolean => a?.since === b.since && a.id === b.id

const main = async (): Promise<void> => {
	await waitForHealth()
	const domiaId = queryOne<{ id: string }>(
		"SELECT id FROM domia WHERE domia_key = ?",
		[env.EVAL_DOMIA_KEY],
	)?.id
	if (!domiaId) throw new Error(`no domia row for ${env.EVAL_DOMIA_KEY}`)

	cleanUp()
	seed(domiaId)

	const seen = STREAMS.map(() => new Set<string>())
	const duplicates = STREAMS.map(() => 0)
	const cursors: SyncStreamCursorType[] = STREAMS.map(() => ({
		since: "",
		id: "",
	}))
	let pages = 0
	let stalled = false
	let routineColumns = false
	let userModelShape = false
	try {
		for (; pages < MAX_PAGES; pages++) {
			const page = await fetchPage(cursors)
			userModelShape =
				page.userModel === null || typeof page.userModel === "object"
			for (const run of page.toolRuns)
				if (
					run.id.startsWith(ID_PREFIX) &&
					run.routineSlug === "sync_streams_probe" &&
					typeof run.stepIndex === "number"
				)
					routineColumns = true
			STREAMS.forEach((stream, k) => {
				for (const row of stream.rows(page)) {
					if (seen[k].has(row.id)) duplicates[k]++
					seen[k].add(row.id)
				}
			})
			const nexts = STREAMS.map((stream) => stream.next(page))
			if (nexts.every((next) => next === null)) break
			if (
				nexts.every((next, k) => next === null || sameCursor(next, cursors[k]))
			) {
				stalled = true
				break
			}
			nexts.forEach((next, k) => {
				if (next) cursors[k] = next
			})
			if (STREAMS.every((stream) => stream.rows(page).length < PAGE_LIMIT))
				break
		}
	} finally {
		cleanUp()
	}

	const sentinelCounts = seen.map(
		(ids) => [...ids].filter((id) => id.startsWith(ID_PREFIX)).length,
	)

	const checks: [string, boolean, string][] = [
		...STREAMS.map((stream, k): [string, boolean, string] => [
			`all same-timestamp ${stream.name} sentinels collected`,
			sentinelCounts[k] === SENTINELS,
			`${sentinelCounts[k]}/${SENTINELS}`,
		]),
		...STREAMS.map((stream, k): [string, boolean, string] => [
			`no duplicate ${stream.name} rows across pages`,
			duplicates[k] === 0,
			`${duplicates[k]} dups`,
		]),
		["the keyset cursors never stalled", !stalled, `stalled=${stalled}`],
		[
			"routineSlug and stepIndex travel on the sync stream",
			routineColumns,
			`routineColumns=${routineColumns}`,
		],
		[
			"userModel is a row or null",
			userModelShape,
			`userModelShape=${userModelShape}`,
		],
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
		`${checks.length - failed}/${checks.length} sync-streams checks passed`,
	)
	if (failed) process.exit(1)
}

void main()

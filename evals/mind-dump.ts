import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import Database from "better-sqlite3"

import { env } from "./lib/env"
import type {
	DomiaMapType,
	DumpFileType,
	DumpTableType,
	MindDumpRowType,
	MindDumpTableSpecType,
	RestoreReportType,
	VerifyIssueType,
} from "./types"

const DOMIA_COLUMN = "domia_id"
const ID_COLUMN = "id"
const ACTIVE_COLUMN = "is_active"
const FACT_TABLE = "memory_fact"
const EVIDENCE_TABLE = "fact_evidence"
const EVIDENCE_FACT_COLUMN = "fact_id"

const TABLES: MindDumpTableSpecType[] = [
	{
		name: "emotion_state",
		naturalKey: [DOMIA_COLUMN],
		singleton: true,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "character_profile",
		naturalKey: [ID_COLUMN],
		singleton: false,
		activeSingleton: true,
		upsertByKey: false,
	},
	{
		name: "user_model",
		naturalKey: [DOMIA_COLUMN],
		singleton: true,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: FACT_TABLE,
		naturalKey: [DOMIA_COLUMN, "subject", "relation", "value_key"],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: EVIDENCE_TABLE,
		naturalKey: [EVIDENCE_FACT_COLUMN, "source_interaction_id"],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "knowledge_entry",
		naturalKey: [ID_COLUMN],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "memory_episode",
		naturalKey: [ID_COLUMN],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "emotion_event",
		naturalKey: [ID_COLUMN],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "proactive_schedule",
		naturalKey: [ID_COLUMN],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "satellite_config",
		naturalKey: [DOMIA_COLUMN, "satellite_id"],
		singleton: false,
		activeSingleton: false,
		upsertByKey: true,
	},
	{
		name: "skill_provider",
		naturalKey: [DOMIA_COLUMN, "name"],
		singleton: false,
		activeSingleton: false,
		upsertByKey: true,
	},
]

const VOLATILE_COLUMNS = new Set(["updated_at", "last_sync_at"])

const argValue = (flag: string): string | undefined => {
	const idx = process.argv.indexOf(flag)
	return idx >= 0 ? process.argv[idx + 1] : undefined
}

const liveColumns = (db: Database.Database, table: string): string[] =>
	(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
		(c) => c.name,
	)

const quote = (c: string): string => `"${c}"`

const stringify = (v: unknown): string => {
	if (v === null || v === undefined) return " "
	if (typeof v === "string") return v
	if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean")
		return String(v)
	if (v instanceof Uint8Array) return Buffer.from(v).toString("base64")
	return JSON.stringify(v)
}

const rowObjects = (section: DumpTableType): MindDumpRowType[] =>
	section.rows.map((r) =>
		Object.fromEntries(section.columns.map((c, i) => [c, r[i]])),
	)

const keyOf = (spec: MindDumpTableSpecType, row: MindDumpRowType): string =>
	spec.naturalKey.map((c) => stringify(row[c])).join("|")

const contentHash = (row: MindDumpRowType, columns: string[]): string => {
	const h = createHash("sha256")
	for (const c of columns) {
		if (c === ID_COLUMN || VOLATILE_COLUMNS.has(c)) continue
		h.update(`${c}=${stringify(row[c])}\n`)
	}
	return h.digest("hex").slice(0, 16)
}

const openRead = (): Database.Database =>
	new Database(env.EVAL_DB, { fileMustExist: true })

const selectDomias = (
	db: Database.Database,
): { id: string; domiaKey: string }[] =>
	db
		.prepare(
			`SELECT ${quote(ID_COLUMN)} AS id, domia_key AS domiaKey FROM domia WHERE is_hosted = 1`,
		)
		.all() as { id: string; domiaKey: string }[]

const belongsToDump = (
	spec: MindDumpTableSpecType,
	columns: string[],
	row: MindDumpRowType,
	hosted: Set<string>,
	dumpedFacts: Set<string>,
): boolean => {
	if (spec.name === EVIDENCE_TABLE)
		return dumpedFacts.has(String(row[EVIDENCE_FACT_COLUMN]))
	return (
		!columns.includes(DOMIA_COLUMN) || hosted.has(String(row[DOMIA_COLUMN]))
	)
}

const danglingEvidence = (dumped: DumpFileType): VerifyIssueType[] => {
	const facts = dumped.tables[FACT_TABLE]
	const evidence = dumped.tables[EVIDENCE_TABLE]
	if (!evidence) return []
	const factIds = new Set(
		(facts ? rowObjects(facts) : []).map((r) => String(r[ID_COLUMN])),
	)
	return rowObjects(evidence)
		.filter((r) => !factIds.has(String(r[EVIDENCE_FACT_COLUMN])))
		.map((r) => ({
			table: EVIDENCE_TABLE,
			key: `${stringify(r[EVIDENCE_FACT_COLUMN])}|${stringify(r.source_interaction_id)}`,
			reason:
				"dump is inconsistent: evidence references a fact missing from the dump",
		}))
}

const dump = (out: string): void => {
	const db = openRead()
	const domias = selectDomias(db)
	const hosted = new Set(domias.map((d) => d.id))
	const dumpedFacts = new Set<string>()
	const tables: Partial<Record<string, DumpTableType>> = {}
	for (const spec of TABLES) {
		const columns = liveColumns(db, spec.name)
		if (columns.length === 0) continue
		const kept = (
			db
				.prepare(`SELECT ${columns.map(quote).join(", ")} FROM ${spec.name}`)
				.all() as MindDumpRowType[]
		).filter((r) => belongsToDump(spec, columns, r, hosted, dumpedFacts))
		if (spec.name === FACT_TABLE)
			for (const r of kept) dumpedFacts.add(String(r[ID_COLUMN]))
		tables[spec.name] = {
			columns,
			rows: kept.map((r) => columns.map((c) => r[c])),
		}
	}
	db.close()
	const file: DumpFileType = {
		version: "mind-dump-2",
		db: env.EVAL_DB,
		dumpedAt: new Date().toISOString(),
		domias,
		tables,
	}
	mkdirSync(dirname(out), { recursive: true })
	writeFileSync(out, JSON.stringify(file), { mode: 0o600 })
	const summary = Object.entries(tables)
		.map(([t, d]) => `${t}=${d?.rows.length ?? 0}`)
		.join(" ")
	console.log(
		`📦 mind dump → ${out} (${domias.map((d) => d.domiaKey).join(",")}; ${summary})`,
	)
}

const readDump = (file: string): DumpFileType => {
	const raw = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }
	if (raw.version !== "mind-dump-2")
		throw new Error(`unsupported dump version: ${String(raw.version)}`)
	return raw as DumpFileType
}

const buildDomiaMap = (
	db: Database.Database,
	dumped: DumpFileType,
	deferMissing: boolean,
): DomiaMapType => {
	const byKey = new Map(selectDomias(db).map((d) => [d.domiaKey, d.id]))
	const map = new Map<string, string>()
	const deferredIds = new Set<string>()
	const deferredKeys: string[] = []
	for (const d of dumped.domias) {
		const target = byKey.get(d.domiaKey)
		if (target === undefined) {
			deferredKeys.push(d.domiaKey)
			deferredIds.add(d.id)
		} else map.set(d.id, target)
	}
	if (deferredKeys.length > 0 && !deferMissing)
		throw new Error(
			`target DB has no domia row for: ${deferredKeys.join(", ")} — boot the node (it seeds the principal) and POST /identities for co-tenants before restoring, or pass --defer-missing to restore the other identities now and re-run for these later`,
		)
	return { map, deferredIds, deferredKeys }
}

const isDeferredRow = (
	row: MindDumpRowType,
	spec: MindDumpTableSpecType,
	deferredIds: Set<string>,
	deferredFacts: Set<string>,
): boolean => {
	if (deferredIds.has(String(row[DOMIA_COLUMN]))) {
		if (spec.name === FACT_TABLE) deferredFacts.add(String(row[ID_COLUMN]))
		return true
	}
	return (
		spec.name === EVIDENCE_TABLE &&
		deferredFacts.has(String(row[EVIDENCE_FACT_COLUMN]))
	)
}

const remapRow = (
	row: MindDumpRowType,
	domiaMap: Map<string, string>,
	factMap: Map<string, string>,
	spec: MindDumpTableSpecType,
): { row: MindDumpRowType; remapped: boolean } => {
	let remapped = false
	const out = { ...row }
	if (DOMIA_COLUMN in out) {
		const mapped = domiaMap.get(String(out[DOMIA_COLUMN]))
		if (mapped !== undefined && mapped !== out[DOMIA_COLUMN]) {
			out[DOMIA_COLUMN] = mapped
			remapped = true
		}
	}
	if (spec.name === EVIDENCE_TABLE) {
		const mapped = factMap.get(String(out[EVIDENCE_FACT_COLUMN]))
		if (mapped !== undefined && mapped !== out[EVIDENCE_FACT_COLUMN]) {
			out[EVIDENCE_FACT_COLUMN] = mapped
			remapped = true
		}
	}
	return { row: out, remapped }
}

const findByNaturalKey = (
	db: Database.Database,
	spec: MindDumpTableSpecType,
	columns: string[],
	row: MindDumpRowType,
): MindDumpRowType | undefined => {
	const where = spec.naturalKey.map((c) => `${quote(c)} = ?`).join(" AND ")
	return db
		.prepare(
			`SELECT ${columns.map(quote).join(", ")} FROM ${spec.name} WHERE ${where}`,
		)
		.get(...spec.naturalKey.map((c) => row[c])) as MindDumpRowType | undefined
}

const findActiveProfile = (
	db: Database.Database,
	columns: string[],
	domiaId: unknown,
): MindDumpRowType | undefined =>
	db
		.prepare(
			`SELECT ${columns.map(quote).join(", ")} FROM character_profile WHERE ${quote(DOMIA_COLUMN)} = ? AND is_active = 1`,
		)
		.get(domiaId) as MindDumpRowType | undefined

const findExisting = (
	db: Database.Database,
	spec: MindDumpTableSpecType,
	columns: string[],
	row: MindDumpRowType,
): MindDumpRowType | undefined => {
	const direct = findByNaturalKey(db, spec, columns, row)
	if (direct) return direct
	return spec.activeSingleton && Number(row[ACTIVE_COLUMN]) === 1
		? findActiveProfile(db, columns, row[DOMIA_COLUMN])
		: undefined
}

const updateInPlace = (
	db: Database.Database,
	spec: MindDumpTableSpecType,
	columns: string[],
	target: MindDumpRowType,
	row: MindDumpRowType,
): void => {
	const settable = columns.filter((c) => c !== ID_COLUMN && c !== DOMIA_COLUMN)
	db.prepare(
		`UPDATE ${spec.name} SET ${settable.map((c) => `${quote(c)} = ?`).join(", ")} WHERE ${quote(ID_COLUMN)} = ?`,
	).run(...settable.map((c) => row[c]), target[ID_COLUMN])
}

const verifyRows = (
	db: Database.Database,
	dumped: DumpFileType,
	deferMissing: boolean,
): VerifyIssueType[] => {
	const issues: VerifyIssueType[] = danglingEvidence(dumped)
	const { map: domiaMap, deferredIds } = buildDomiaMap(db, dumped, deferMissing)
	{
		const factMap = new Map<string, string>()
		const deferredFacts = new Set<string>()
		for (const spec of TABLES) {
			const section = dumped.tables[spec.name]
			if (!section) continue
			const liveSet = new Set(liveColumns(db, spec.name))
			const columns = section.columns.filter((c) => liveSet.has(c))
			for (const original of rowObjects(section)) {
				if (isDeferredRow(original, spec, deferredIds, deferredFacts)) continue
				const { row } = remapRow(original, domiaMap, factMap, spec)
				const found = findExisting(db, spec, columns, row)
				if (!found) {
					issues.push({
						table: spec.name,
						key: keyOf(spec, row),
						reason: "missing",
					})
					continue
				}
				if (spec.name === FACT_TABLE && found[ID_COLUMN] !== row[ID_COLUMN])
					factMap.set(String(row[ID_COLUMN]), String(found[ID_COLUMN]))
				if (contentHash(found, columns) !== contentHash(row, columns))
					issues.push({
						table: spec.name,
						key: keyOf(spec, row),
						reason: "content differs",
					})
			}
		}
	}
	return issues
}

const verifyAgainst = (
	dumped: DumpFileType,
	deferMissing: boolean,
): VerifyIssueType[] => {
	const db = openRead()
	try {
		return verifyRows(db, dumped, deferMissing)
	} finally {
		db.close()
	}
}

const printIssues = (label: string, issues: VerifyIssueType[]): void => {
	console.error(`❌ ${label}: ${issues.length} issue(s)`)
	for (const i of issues.slice(0, 20))
		console.error(`  ${i.table} ${i.key}: ${i.reason}`)
}

const restore = (file: string, deferMissing: boolean): void => {
	const dumped = readDump(file)
	const dangling = danglingEvidence(dumped)
	if (dangling.length > 0)
		throw new Error(
			`restore refused, nothing written — ${dangling.length} ${EVIDENCE_TABLE} row(s) reference facts missing from ${file}:\n  ${dangling.map((i) => i.key).join("\n  ")}`,
		)
	const db = new Database(env.EVAL_DB, { fileMustExist: true })
	db.pragma("foreign_keys = ON")
	const {
		map: domiaMap,
		deferredIds,
		deferredKeys,
	} = buildDomiaMap(db, dumped, deferMissing)
	const factMap = new Map<string, string>()
	const deferredFacts = new Set<string>()
	const reports: string[] = []
	const conflicts: string[] = []
	const fkBefore = db.prepare("PRAGMA foreign_key_check").all().length
	const run = db.transaction(() => {
		for (const spec of TABLES) {
			const section = dumped.tables[spec.name]
			if (!section || section.rows.length === 0) continue
			const liveSet = new Set(liveColumns(db, spec.name))
			const columns = section.columns.filter((c) => liveSet.has(c))
			const dropped = section.columns.length - columns.length
			const report: RestoreReportType = {
				deferred: 0,
				inserted: 0,
				matched: 0,
				updated: 0,
				remapped: 0,
			}
			const insert = db.prepare(
				`INSERT INTO ${spec.name} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
			)
			for (const original of rowObjects(section)) {
				if (isDeferredRow(original, spec, deferredIds, deferredFacts)) {
					report.deferred += 1
					continue
				}
				const { row, remapped } = remapRow(original, domiaMap, factMap, spec)
				if (remapped) report.remapped += 1
				const existing = findExisting(db, spec, columns, row)
				if (existing) {
					if (contentHash(existing, columns) === contentHash(row, columns))
						report.matched += 1
					else if (spec.singleton || spec.activeSingleton || spec.upsertByKey) {
						updateInPlace(db, spec, columns, existing, row)
						report.updated += 1
					} else
						conflicts.push(
							`${spec.name} ${keyOf(spec, row)}: exists with different content`,
						)
					if (
						spec.name === FACT_TABLE &&
						existing[ID_COLUMN] !== row[ID_COLUMN]
					)
						factMap.set(String(row[ID_COLUMN]), String(existing[ID_COLUMN]))
					continue
				}
				insert.run(...columns.map((c) => row[c]))
				report.inserted += 1
			}
			reports.push(
				`${spec.name}: +${report.inserted} inserted, ${report.matched} matched, ${report.updated} updated, ${report.remapped} remapped${report.deferred > 0 ? `, ${report.deferred} deferred` : ""}${dropped > 0 ? `, ${dropped} old columns skipped` : ""}`,
			)
		}
		if (conflicts.length > 0)
			throw new Error(
				`restore aborted, nothing written:\n  ${conflicts.join("\n  ")}`,
			)
		const fkAfter = db.prepare("PRAGMA foreign_key_check").all().length
		if (fkAfter > fkBefore)
			throw new Error(
				`restore aborted, foreign_key_check went from ${fkBefore} to ${fkAfter} violation(s)`,
			)
		if (fkBefore > 0)
			reports.push(
				`note: ${fkBefore} pre-existing foreign-key violation(s) in the target DB (not caused by this restore)`,
			)
		const issues = verifyRows(db, dumped, deferMissing)
		if (issues.length > 0)
			throw new Error(
				`restore aborted, nothing written — verify found ${issues.length} issue(s):\n  ${issues.map((i) => `${i.table} ${i.key}: ${i.reason}`).join("\n  ")}`,
			)
	})
	try {
		run()
	} finally {
		db.close()
	}
	console.log(`✅ mind restore ← ${file}\n  ${reports.join("\n  ")}`)
	if (deferredKeys.length > 0)
		console.log(
			`⏸ deferred identities: ${deferredKeys.join(", ")} — their rows stay in ${file}; re-run restore with the same file once they exist`,
		)
	console.log(
		"✅ verify: every dumped row was re-read inside the transaction with identical content",
	)
}

const verify = (file: string, deferMissing: boolean): void => {
	const issues = verifyAgainst(readDump(file), deferMissing)
	if (issues.length === 0) {
		console.log(
			`✅ verify ${file}: every dumped row is present with identical content`,
		)
		return
	}
	printIssues(`verify ${file}`, issues)
	process.exit(1)
}

const counts = (): void => {
	const db = openRead()
	const line = TABLES.map((t) => {
		const r = db.prepare(`SELECT count(*) AS n FROM ${t.name}`).get() as {
			n: number
		}
		return `${t.name}=${r.n}`
	}).join(" ")
	db.close()
	console.log(line)
}

const mode = process.argv[2]
const fileArg = process.argv[3] as string | undefined
const deferMissing = process.argv.includes("--defer-missing")
if (mode === "dump")
	dump(argValue("--out") ?? `data/snapshots/mind-${Date.now()}.json`)
else if (mode === "restore" && fileArg !== undefined)
	restore(fileArg, deferMissing)
else if (mode === "verify" && fileArg !== undefined)
	verify(fileArg, deferMissing)
else if (mode === "counts") counts()
else {
	console.error(
		"usage: evals/mind-dump.ts dump [--out file] | restore <file> [--defer-missing] | verify <file> [--defer-missing] | counts   (EVAL_DB; restore needs the node booted so the identities exist)",
	)
	process.exit(2)
}

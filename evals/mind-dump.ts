import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import Database from "better-sqlite3"

import {
	MIND_SECTIONS,
	applyMindSections,
	buildDomiaMap,
	collectMindSections,
	danglingEvidence,
	hostedIdentities,
	mindSectionsSchema,
	verifyMindSections,
	type MindApplyReportType,
	type MindResolveDomiaIdType,
	type MindSectionsType,
	type MindTransferIssueType,
} from "@/modules/mind-transfer"

import { env } from "./lib/env"
import type { DumpFileType } from "./types"

const DUMP_VERSION = "mind-dump-2"

const argValue = (flag: string): string | undefined => {
	const idx = process.argv.indexOf(flag)
	return idx >= 0 ? process.argv[idx + 1] : undefined
}

const openDb = (writable: boolean): Database.Database => {
	const db = new Database(env.EVAL_DB, { fileMustExist: true })
	if (writable) db.pragma("foreign_keys = ON")
	return db
}

const readDump = (file: string): DumpFileType => {
	const raw = JSON.parse(readFileSync(file, "utf8")) as {
		version?: unknown
		domias?: unknown
		tables?: unknown
	}
	if (raw.version !== DUMP_VERSION)
		throw new Error(`unsupported dump version: ${String(raw.version)}`)
	return {
		...(raw as DumpFileType),
		tables: mindSectionsSchema.parse(raw.tables ?? {}),
	}
}

const resolverFor = (
	db: Database.Database,
	dumped: DumpFileType,
	deferMissing: boolean,
): { resolve: MindResolveDomiaIdType; deferredKeys: string[] } => {
	const { map, deferredKeys } = buildDomiaMap(db, dumped.domias)
	if (deferredKeys.length > 0 && !deferMissing)
		throw new Error(
			`target DB has no domia row for: ${deferredKeys.join(", ")} — boot the node (it seeds the principal) and POST /identities for co-tenants before restoring, or pass --defer-missing to restore the other identities now and re-run for these later`,
		)
	return { resolve: (id) => map.get(String(id)), deferredKeys }
}

const dump = (out: string): void => {
	const db = openDb(false)
	const domias = hostedIdentities(db)
	const tables = collectMindSections(db, domias)
	db.close()
	const file: DumpFileType = {
		version: DUMP_VERSION,
		db: env.EVAL_DB,
		dumpedAt: new Date().toISOString(),
		domias,
		tables,
	}
	mkdirSync(dirname(out), { recursive: true })
	writeFileSync(out, JSON.stringify(file), { mode: 0o600 })
	const summary = Object.entries(tables)
		.map(([t, d]) => `${t}=${d.rows.length}`)
		.join(" ")
	console.log(
		`📦 mind dump → ${out} (${domias.map((d) => d.domiaKey).join(",")}; ${summary})`,
	)
}

const printIssues = (label: string, issues: MindTransferIssueType[]): void => {
	console.error(`❌ ${label}: ${issues.length} issue(s)`)
	for (const i of issues.slice(0, 20))
		console.error(`  ${i.table} ${i.key}: ${i.reason}`)
}

const refuseDangling = (file: string, tables: MindSectionsType): void => {
	const dangling = danglingEvidence(tables)
	if (dangling.length === 0) return
	throw new Error(
		`restore refused, nothing written — ${dangling.length} fact_evidence row(s) reference facts missing from ${file}:\n  ${dangling.map((i) => i.key).join("\n  ")}`,
	)
}

const restore = (file: string, deferMissing: boolean): void => {
	const dumped = readDump(file)
	refuseDangling(file, dumped.tables)
	const db = openDb(true)
	const { report, deferredKeys } = ((): {
		report: MindApplyReportType
		deferredKeys: string[]
	} => {
		try {
			const resolver = resolverFor(db, dumped, deferMissing)
			return {
				report: applyMindSections(db, dumped.tables, {
					mode: "merge",
					resolveDomiaId: resolver.resolve,
				}),
				deferredKeys: resolver.deferredKeys,
			}
		} finally {
			db.close()
		}
	})()
	const lines = Object.entries(report.sections).map(([name, r]) =>
		[
			`${name}: +${r.inserted} inserted, ${r.matched} matched, ${r.updated} updated, ${r.remapped} remapped`,
			r.reidentified > 0 ? `, ${r.reidentified} re-identified` : "",
			r.deferred > 0 ? `, ${r.deferred} deferred` : "",
			r.droppedColumns > 0 ? `, ${r.droppedColumns} old columns skipped` : "",
		].join(""),
	)
	if (report.preexistingForeignKeyViolations > 0)
		lines.push(
			`note: ${report.preexistingForeignKeyViolations} pre-existing foreign-key violation(s) in the target DB (not caused by this restore)`,
		)
	console.log(`✅ mind restore ← ${file}\n  ${lines.join("\n  ")}`)
	if (deferredKeys.length > 0)
		console.log(
			`⏸ deferred identities: ${deferredKeys.join(", ")} — their rows stay in ${file}; re-run restore with the same file once they exist`,
		)
	console.log(
		"✅ verify: every dumped row was re-read inside the transaction with identical content",
	)
}

const verify = (file: string, deferMissing: boolean): void => {
	const dumped = readDump(file)
	const db = openDb(false)
	let issues: MindTransferIssueType[]
	try {
		const { resolve } = resolverFor(db, dumped, deferMissing)
		issues = verifyMindSections(db, dumped.tables, resolve)
	} finally {
		db.close()
	}
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
	const db = openDb(false)
	const line = MIND_SECTIONS.map((table) => {
		const r = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
			n: number
		}
		return `${table}=${r.n}`
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

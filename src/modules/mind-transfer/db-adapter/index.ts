import type Database from "better-sqlite3"

import { sqliteClient } from "@/db"
import {
	MIND_ACTIVE_COLUMN,
	MIND_BUILTIN_PROTOCOL,
	MIND_DOMIA_COLUMN,
	MIND_EVIDENCE_FACT_COLUMN,
	MIND_EVIDENCE_SECTION,
	MIND_FACT_SECTION,
	MIND_ID_COLUMN,
	MIND_PROVIDER_PROTOCOL_COLUMN,
	MIND_PROVIDER_SECTION,
} from "../constants"
import type {
	MindIdentityRefType,
	MindRowInserterType,
	MindRowType,
	MindSectionSpecType,
	MindSectionType,
} from "../types"

const quote = (c: string): string => `"${c}"`

const columnList = (columns: string[]): string => columns.map(quote).join(", ")

const dbAdapter = {
	coreDb: (): Database.Database => sqliteClient,

	liveColumns: (db: Database.Database, table: MindSectionType): string[] =>
		(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
			(c) => c.name,
		),

	hostedDomias: (db: Database.Database): MindIdentityRefType[] =>
		db
			.prepare(
				`SELECT ${quote(MIND_ID_COLUMN)} AS id, domia_key AS domiaKey FROM domia WHERE is_hosted = 1`,
			)
			.all() as MindIdentityRefType[],

	domiaById: (
		db: Database.Database,
		domiaId: string,
	): MindIdentityRefType | undefined =>
		db
			.prepare(
				`SELECT ${quote(MIND_ID_COLUMN)} AS id, domia_key AS domiaKey FROM domia WHERE ${quote(MIND_ID_COLUMN)} = ?`,
			)
			.get(domiaId) as MindIdentityRefType | undefined,

	selectAll: (
		db: Database.Database,
		table: MindSectionType,
		columns: string[],
	): MindRowType[] =>
		db
			.prepare(`SELECT ${columnList(columns)} FROM ${table}`)
			.all() as MindRowType[],

	selectByKey: (
		db: Database.Database,
		table: MindSectionType,
		columns: string[],
		keyColumns: string[],
		row: MindRowType,
	): MindRowType | undefined =>
		db
			.prepare(
				`SELECT ${columnList(columns)} FROM ${table} WHERE ${keyColumns
					.map((c) => `${quote(c)} = ?`)
					.join(" AND ")}`,
			)
			.get(...keyColumns.map((c) => row[c])) as MindRowType | undefined,

	selectForDomia: (
		db: Database.Database,
		table: MindSectionType,
		columns: string[],
		domiaId: unknown,
	): MindRowType[] =>
		db
			.prepare(
				`SELECT ${columnList(columns)} FROM ${table} WHERE ${quote(MIND_DOMIA_COLUMN)} = ?`,
			)
			.all(domiaId) as MindRowType[],

	idExists: (
		db: Database.Database,
		table: MindSectionType,
		id: unknown,
	): boolean =>
		db
			.prepare(
				`SELECT 1 AS present FROM ${table} WHERE ${quote(MIND_ID_COLUMN)} = ?`,
			)
			.get(id) !== undefined,

	selectActiveProfile: (
		db: Database.Database,
		columns: string[],
		domiaId: unknown,
	): MindRowType | undefined =>
		db
			.prepare(
				`SELECT ${columnList(columns)} FROM character_profile WHERE ${quote(MIND_DOMIA_COLUMN)} = ? AND ${quote(MIND_ACTIVE_COLUMN)} = 1`,
			)
			.get(domiaId) as MindRowType | undefined,

	rowInserter: (
		db: Database.Database,
		table: MindSectionType,
	): MindRowInserterType => {
		const statements = new Map<string, Database.Statement>()
		return (columns, row) => {
			const key = columns.join(",")
			const statement =
				statements.get(key) ??
				db.prepare(
					`INSERT INTO ${table} (${columnList(columns)}) VALUES (${columns.map(() => "?").join(", ")})`,
				)
			statements.set(key, statement)
			statement.run(...columns.map((c) => row[c]))
		}
	},

	updateInPlace: (
		db: Database.Database,
		spec: MindSectionSpecType,
		columns: string[],
		targetId: unknown,
		row: MindRowType,
	): void => {
		const settable = columns.filter(
			(c) => c !== MIND_ID_COLUMN && c !== MIND_DOMIA_COLUMN,
		)
		if (settable.length === 0) return
		db.prepare(
			`UPDATE ${spec.name} SET ${settable.map((c) => `${quote(c)} = ?`).join(", ")} WHERE ${quote(MIND_ID_COLUMN)} = ?`,
		).run(...settable.map((c) => row[c]), targetId)
	},

	deactivateOtherProfiles: (
		db: Database.Database,
		domiaId: unknown,
		keepId: unknown,
	): void => {
		db.prepare(
			`UPDATE character_profile SET ${quote(MIND_ACTIVE_COLUMN)} = 0 WHERE ${quote(MIND_DOMIA_COLUMN)} = ? AND ${quote(MIND_ID_COLUMN)} <> ? AND ${quote(MIND_ACTIVE_COLUMN)} = 1`,
		).run(domiaId, keepId)
	},

	deleteSectionForDomia: (
		db: Database.Database,
		table: MindSectionType,
		domiaId: string,
	): number =>
		table === MIND_PROVIDER_SECTION
			? db
					.prepare(
						`DELETE FROM ${table} WHERE ${quote(MIND_DOMIA_COLUMN)} = ? AND ${quote(MIND_PROVIDER_PROTOCOL_COLUMN)} <> ?`,
					)
					.run(domiaId, MIND_BUILTIN_PROTOCOL).changes
			: db
					.prepare(`DELETE FROM ${table} WHERE ${quote(MIND_DOMIA_COLUMN)} = ?`)
					.run(domiaId).changes,

	deleteEvidenceForDomia: (db: Database.Database, domiaId: string): number =>
		db
			.prepare(
				`DELETE FROM ${MIND_EVIDENCE_SECTION} WHERE ${quote(MIND_EVIDENCE_FACT_COLUMN)} IN (SELECT ${quote(MIND_ID_COLUMN)} FROM ${MIND_FACT_SECTION} WHERE ${quote(MIND_DOMIA_COLUMN)} = ?)`,
			)
			.run(domiaId).changes,

	foreignKeyViolations: (db: Database.Database): number =>
		db.prepare("PRAGMA foreign_key_check").all().length,
}

export default dbAdapter

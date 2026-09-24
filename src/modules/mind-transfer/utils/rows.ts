import { createHash } from "node:crypto"

import {
	MIND_ID_COLUMN,
	MIND_SECRET_COLUMNS,
	MIND_SECTION_SPECS,
	MIND_VOLATILE_COLUMNS,
} from "../constants"
import type {
	MindRowType,
	MindSectionDataType,
	MindSectionSpecType,
	MindSectionType,
	MindSectionsType,
} from "../types"

export const stringifyCell = (v: unknown): string => {
	if (v === null || v === undefined) return " "
	if (typeof v === "string") return v
	if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean")
		return String(v)
	if (v instanceof Uint8Array) return Buffer.from(v).toString("base64")
	return JSON.stringify(v)
}

export const rowObjects = (section: MindSectionDataType): MindRowType[] =>
	section.rows.map((r) =>
		Object.fromEntries(section.columns.map((c, i) => [c, r[i]])),
	)

export const keyOf = (spec: MindSectionSpecType, row: MindRowType): string =>
	spec.naturalKey.map((c) => stringifyCell(row[c])).join("|")

export const contentHash = (row: MindRowType, columns: string[]): string => {
	const h = createHash("sha256")
	for (const c of columns) {
		if (c === MIND_ID_COLUMN || MIND_VOLATILE_COLUMNS.has(c)) continue
		h.update(`${c}=${stringifyCell(row[c])}\n`)
	}
	return h.digest("hex").slice(0, 16)
}

export const selectedSpecs = (
	sections?: MindSectionType[],
): MindSectionSpecType[] =>
	sections === undefined
		? MIND_SECTION_SPECS
		: MIND_SECTION_SPECS.filter((s) => sections.includes(s.name))

export const specsCarriedBy = (
	specs: MindSectionSpecType[],
	sections: MindSectionsType,
): MindSectionSpecType[] => specs.filter((s) => sections[s.name] !== undefined)

const isRedactedCell = (
	spec: MindSectionSpecType,
	column: string,
	row: MindRowType,
): boolean =>
	row[column] === null &&
	(MIND_SECRET_COLUMNS[spec.name]?.includes(column) ?? false)

export const unredactedColumns = (
	spec: MindSectionSpecType,
	columns: string[],
	row: MindRowType,
): string[] => columns.filter((c) => !isRedactedCell(spec, c, row))

export const sameContent = (
	spec: MindSectionSpecType,
	columns: string[],
	existing: MindRowType,
	incoming: MindRowType,
): boolean => {
	const compared = unredactedColumns(spec, columns, incoming)
	return contentHash(existing, compared) === contentHash(incoming, compared)
}

export const rowKey = (spec: MindSectionSpecType, row: MindRowType): string =>
	`${spec.name}|${keyOf(spec, row)}`

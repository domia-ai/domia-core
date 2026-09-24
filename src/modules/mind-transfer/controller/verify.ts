import type Database from "better-sqlite3"

import dbAdapter from "../db-adapter"
import {
	MIND_ACTIVE_COLUMN,
	MIND_DOMIA_COLUMN,
	MIND_EVIDENCE_FACT_COLUMN,
	MIND_EVIDENCE_SECTION,
	MIND_FACT_SECTION,
	MIND_ID_COLUMN,
} from "../constants"
import {
	contentHash,
	keyOf,
	rowKey,
	rowObjects,
	sameContent,
	selectedSpecs,
} from "../utils/rows"
import type {
	MindContentIndexType,
	MindResolveDomiaIdType,
	MindRowType,
	MindSectionSpecType,
	MindSectionType,
	MindSectionsType,
	MindTransferIssueType,
} from "../types"

export const danglingEvidence = (
	sections: MindSectionsType,
): MindTransferIssueType[] => {
	const evidence = sections[MIND_EVIDENCE_SECTION]
	if (!evidence) return []
	const facts = sections[MIND_FACT_SECTION]
	const factIds = new Set(
		(facts ? rowObjects(facts) : []).map((r) => String(r[MIND_ID_COLUMN])),
	)
	return rowObjects(evidence)
		.filter((r) => !factIds.has(String(r[MIND_EVIDENCE_FACT_COLUMN])))
		.map((r) => ({
			table: MIND_EVIDENCE_SECTION,
			key: `${String(r[MIND_EVIDENCE_FACT_COLUMN])}|${String(r.source_interaction_id)}`,
			reason:
				"bundle is inconsistent: evidence references a fact missing from the bundle",
		}))
}

export const isDeferredRow = (
	row: MindRowType,
	spec: MindSectionSpecType,
	resolveDomiaId: MindResolveDomiaIdType,
	deferredFacts: Set<string>,
): boolean => {
	if (
		MIND_DOMIA_COLUMN in row &&
		resolveDomiaId(row[MIND_DOMIA_COLUMN]) === undefined
	) {
		if (spec.name === MIND_FACT_SECTION)
			deferredFacts.add(String(row[MIND_ID_COLUMN]))
		return true
	}
	return (
		spec.name === MIND_EVIDENCE_SECTION &&
		deferredFacts.has(String(row[MIND_EVIDENCE_FACT_COLUMN]))
	)
}

export const remapRow = (
	row: MindRowType,
	spec: MindSectionSpecType,
	resolveDomiaId: MindResolveDomiaIdType,
	factMap: Map<string, string>,
): { row: MindRowType; remapped: boolean } => {
	const out = { ...row }
	let remapped = false
	if (MIND_DOMIA_COLUMN in out) {
		const mapped = resolveDomiaId(out[MIND_DOMIA_COLUMN])
		if (mapped !== undefined && mapped !== out[MIND_DOMIA_COLUMN]) {
			out[MIND_DOMIA_COLUMN] = mapped
			remapped = true
		}
	}
	if (spec.name === MIND_EVIDENCE_SECTION) {
		const mapped = factMap.get(String(out[MIND_EVIDENCE_FACT_COLUMN]))
		if (mapped !== undefined && mapped !== out[MIND_EVIDENCE_FACT_COLUMN]) {
			out[MIND_EVIDENCE_FACT_COLUMN] = mapped
			remapped = true
		}
	}
	return { row: out, remapped }
}

export const scopedNaturalKey = (
	spec: MindSectionSpecType,
	columns: string[],
): string[] =>
	columns.includes(MIND_DOMIA_COLUMN) &&
	!spec.naturalKey.includes(MIND_DOMIA_COLUMN)
		? [...spec.naturalKey, MIND_DOMIA_COLUMN]
		: spec.naturalKey

export const createContentIndex = (
	db: Database.Database,
): MindContentIndexType => {
	const cache = new Map<string, Map<string, MindRowType[]>>()
	const indexFor = (
		spec: MindSectionSpecType,
		columns: string[],
		domiaId: unknown,
	): Map<string, MindRowType[]> => {
		const cacheKey = `${spec.name}|${String(domiaId)}`
		const cached = cache.get(cacheKey)
		if (cached) return cached
		const built = new Map<string, MindRowType[]>()
		for (const existing of dbAdapter.selectForDomia(
			db,
			spec.name,
			columns,
			domiaId,
		)) {
			const hash = contentHash(existing, columns)
			built.set(hash, [...(built.get(hash) ?? []), existing])
		}
		cache.set(cacheKey, built)
		return built
	}
	return (spec, columns, row) => {
		if (!columns.includes(MIND_DOMIA_COLUMN)) return undefined
		const bucket = indexFor(spec, columns, row[MIND_DOMIA_COLUMN]).get(
			contentHash(row, columns),
		)
		return bucket?.shift()
	}
}

export const findExisting = (
	db: Database.Database,
	spec: MindSectionSpecType,
	columns: string[],
	row: MindRowType,
	index?: MindContentIndexType,
): MindRowType | undefined => {
	const direct = dbAdapter.selectByKey(
		db,
		spec.name,
		columns,
		scopedNaturalKey(spec, columns),
		row,
	)
	if (direct) return direct
	if (spec.activeSingleton && Number(row[MIND_ACTIVE_COLUMN]) === 1) {
		const active = dbAdapter.selectActiveProfile(
			db,
			columns,
			row[MIND_DOMIA_COLUMN],
		)
		if (active) return active
	}
	if (
		!index ||
		!columns.includes(MIND_ID_COLUMN) ||
		!(MIND_DOMIA_COLUMN in row) ||
		!dbAdapter.idExists(db, spec.name, row[MIND_ID_COLUMN])
	)
		return undefined
	return index(spec, columns, row)
}

export const liveSectionColumns = (
	db: Database.Database,
	section: MindSectionType,
	columns: string[],
): string[] => {
	const live = new Set(dbAdapter.liveColumns(db, section))
	return columns.filter((c) => live.has(c))
}

export const verifyMindSections = (
	db: Database.Database,
	sections: MindSectionsType,
	resolveDomiaId: MindResolveDomiaIdType,
	only?: MindSectionType[],
	skippedKeys: Set<string> = new Set(),
): MindTransferIssueType[] => {
	const issues: MindTransferIssueType[] = danglingEvidence(sections)
	const index = createContentIndex(db)
	const factMap = new Map<string, string>()
	const deferredFacts = new Set<string>()
	for (const spec of selectedSpecs(only)) {
		const section = sections[spec.name]
		if (!section) continue
		const columns = liveSectionColumns(db, spec.name, section.columns)
		for (const original of rowObjects(section)) {
			if (isDeferredRow(original, spec, resolveDomiaId, deferredFacts)) continue
			const { row } = remapRow(original, spec, resolveDomiaId, factMap)
			const found = findExisting(db, spec, columns, row, index)
			if (!found) {
				issues.push({
					table: spec.name,
					key: keyOf(spec, row),
					reason: "missing",
				})
				continue
			}
			if (
				spec.name === MIND_FACT_SECTION &&
				found[MIND_ID_COLUMN] !== row[MIND_ID_COLUMN]
			)
				factMap.set(String(row[MIND_ID_COLUMN]), String(found[MIND_ID_COLUMN]))
			if (skippedKeys.has(rowKey(spec, row))) continue
			if (!sameContent(spec, columns, found, row))
				issues.push({
					table: spec.name,
					key: keyOf(spec, row),
					reason: "content differs",
				})
		}
	}
	return issues
}

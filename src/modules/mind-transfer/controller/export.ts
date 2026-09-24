import type Database from "better-sqlite3"

import { domiaError, mindTransferLogger, MIND_TRANSFER_ERRORS } from "@/utils"
import dbAdapter from "../db-adapter"
import {
	MIND_BUILTIN_PROTOCOL,
	MIND_BUNDLE_VERSION,
	MIND_DOMIA_COLUMN,
	MIND_EVIDENCE_FACT_COLUMN,
	MIND_EVIDENCE_SECTION,
	MIND_FACT_SECTION,
	MIND_ID_COLUMN,
	MIND_PROVIDER_PROTOCOL_COLUMN,
	MIND_PROVIDER_SECTION,
	MIND_SECRET_COLUMNS,
} from "../constants"
import { selectedSpecs } from "../utils/rows"
import type {
	MindBundleType,
	MindCollectOptionsType,
	MindExportOptionsType,
	MindIdentityRefType,
	MindRowType,
	MindSectionSpecType,
	MindSectionsType,
} from "../types"

const belongsToExport = (
	spec: MindSectionSpecType,
	columns: string[],
	row: MindRowType,
	hosted: Set<string>,
	exportedFacts: Set<string>,
): boolean => {
	if (spec.name === MIND_EVIDENCE_SECTION)
		return exportedFacts.has(String(row[MIND_EVIDENCE_FACT_COLUMN]))
	if (
		spec.name === MIND_PROVIDER_SECTION &&
		row[MIND_PROVIDER_PROTOCOL_COLUMN] === MIND_BUILTIN_PROTOCOL
	)
		return false
	return (
		!columns.includes(MIND_DOMIA_COLUMN) ||
		hosted.has(String(row[MIND_DOMIA_COLUMN]))
	)
}

const redactedCell = (
	spec: MindSectionSpecType,
	column: string,
	value: unknown,
): unknown => (MIND_SECRET_COLUMNS[spec.name]?.includes(column) ? null : value)

export const collectMindSections = (
	db: Database.Database,
	domias: MindIdentityRefType[],
	{ sections, redactSecrets = false }: MindCollectOptionsType = {},
): MindSectionsType => {
	const hosted = new Set(domias.map((d) => d.id))
	const exportedFacts = new Set<string>()
	const collected: MindSectionsType = {}
	for (const spec of selectedSpecs(sections)) {
		const columns = dbAdapter.liveColumns(db, spec.name)
		if (columns.length === 0) continue
		const kept = dbAdapter
			.selectAll(db, spec.name, columns)
			.filter((r) => belongsToExport(spec, columns, r, hosted, exportedFacts))
		if (spec.name === MIND_FACT_SECTION)
			for (const r of kept) exportedFacts.add(String(r[MIND_ID_COLUMN]))
		collected[spec.name] = {
			columns,
			rows: kept.map((r) =>
				columns.map((c) =>
					redactSecrets ? redactedCell(spec, c, r[c]) : r[c],
				),
			),
		}
	}
	return collected
}

export const hostedIdentities = (
	db: Database.Database,
): MindIdentityRefType[] => dbAdapter.hostedDomias(db)

export const exportMind = (
	domiaId: string,
	{ sections }: MindExportOptionsType = {},
): MindBundleType => {
	const db = dbAdapter.coreDb()
	const domia = dbAdapter.domiaById(db, domiaId)
	if (!domia)
		throw domiaError(MIND_TRANSFER_ERRORS.IDENTITY_NOT_FOUND, {
			logger: mindTransferLogger,
			meta: { domiaId },
		})
	const bundle: MindBundleType = {
		version: MIND_BUNDLE_VERSION,
		exportedAt: new Date().toISOString(),
		sourceDomiaKey: domia.domiaKey,
		sections: collectMindSections(db, [domia], {
			sections,
			redactSecrets: true,
		}),
	}
	mindTransferLogger.info("📦 mind exported", {
		domiaId,
		domiaKey: domia.domiaKey,
		sections: Object.entries(bundle.sections)
			.map(([name, data]) => `${name}=${data.rows.length}`)
			.join(" "),
	})
	return bundle
}

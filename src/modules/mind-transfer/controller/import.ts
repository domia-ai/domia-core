import type Database from "better-sqlite3"

import { ensureBuiltinProvider } from "@/modules/skill-engine"
import {
	domiaError,
	generateUuid,
	mindTransferLogger,
	MIND_TRANSFER_ERRORS,
} from "@/utils"
import dbAdapter from "../db-adapter"
import {
	MIND_ACTIVE_COLUMN,
	MIND_DEFAULT_IMPORT_ON_CONFLICT,
	MIND_DOMIA_COLUMN,
	MIND_EVIDENCE_SECTION,
	MIND_FACT_SECTION,
	MIND_ID_COLUMN,
	MIND_PROVIDER_SECTION,
} from "../constants"
import { mindBundleSchema } from "../schemas"
import {
	keyOf,
	rowKey,
	rowObjects,
	sameContent,
	selectedSpecs,
	specsCarriedBy,
	unredactedColumns,
} from "../utils/rows"
import {
	createContentIndex,
	danglingEvidence,
	findExisting,
	isDeferredRow,
	liveSectionColumns,
	remapRow,
	verifyMindSections,
} from "./verify"
import type {
	MindApplyOptionsType,
	MindApplyReportType,
	MindBundleType,
	MindDomiaMapType,
	MindIdentityRefType,
	MindImportOptionsType,
	MindImportReportType,
	MindRowType,
	MindSectionReportType,
	MindSectionSpecType,
	MindSectionType,
	MindSectionsType,
} from "../types"

const emptyReport = (): MindSectionReportType => ({
	cleared: 0,
	deferred: 0,
	inserted: 0,
	matched: 0,
	updated: 0,
	skipped: 0,
	remapped: 0,
	reidentified: 0,
	droppedColumns: 0,
})

export const buildDomiaMap = (
	db: Database.Database,
	sourceDomias: MindIdentityRefType[],
): MindDomiaMapType => {
	const byKey = new Map(
		dbAdapter.hostedDomias(db).map((d) => [d.domiaKey, d.id]),
	)
	const map = new Map<string, string>()
	const deferredIds = new Set<string>()
	const deferredKeys: string[] = []
	for (const d of sourceDomias) {
		const target = byKey.get(d.domiaKey)
		if (target === undefined) {
			deferredKeys.push(d.domiaKey)
			deferredIds.add(d.id)
		} else map.set(d.id, target)
	}
	return { map, deferredIds, deferredKeys }
}

const clearSections = (
	db: Database.Database,
	specs: MindSectionSpecType[],
	targetDomiaId: string,
	reports: Partial<Record<MindSectionType, MindSectionReportType>>,
): void => {
	const clearsFacts = specs.some(
		(s) => s.name === MIND_EVIDENCE_SECTION || s.name === MIND_FACT_SECTION,
	)
	if (clearsFacts) {
		const report = (reports[MIND_EVIDENCE_SECTION] ??= emptyReport())
		report.cleared = dbAdapter.deleteEvidenceForDomia(db, targetDomiaId)
	}
	for (const spec of specs) {
		if (spec.name === MIND_EVIDENCE_SECTION) continue
		const columns = dbAdapter.liveColumns(db, spec.name)
		if (!columns.includes(MIND_DOMIA_COLUMN)) continue
		const report = (reports[spec.name] ??= emptyReport())
		report.cleared = dbAdapter.deleteSectionForDomia(
			db,
			spec.name,
			targetDomiaId,
		)
	}
	if (specs.some((s) => s.name === MIND_PROVIDER_SECTION))
		ensureBuiltinProvider(targetDomiaId)
}

const keepSingleActiveProfile = (
	db: Database.Database,
	spec: MindSectionSpecType,
	row: MindRowType,
	writtenId: unknown,
): void => {
	if (!spec.activeSingleton || Number(row[MIND_ACTIVE_COLUMN]) !== 1) return
	dbAdapter.deactivateOtherProfiles(db, row[MIND_DOMIA_COLUMN], writtenId)
}

export const applyMindSections = (
	db: Database.Database,
	sections: MindSectionsType,
	options: MindApplyOptionsType,
): MindApplyReportType => {
	const {
		mode,
		resolveDomiaId,
		replaceTargetDomiaId,
		onConflict = MIND_DEFAULT_IMPORT_ON_CONFLICT,
	} = options
	if (mode === "replace" && !replaceTargetDomiaId)
		throw domiaError(MIND_TRANSFER_ERRORS.REPLACE_TARGET_MISSING, {
			logger: mindTransferLogger,
		})
	const dangling = danglingEvidence(sections)
	if (dangling.length > 0)
		throw domiaError(MIND_TRANSFER_ERRORS.BUNDLE_INCONSISTENT, {
			logger: mindTransferLogger,
			meta: { issues: dangling.map((i) => `${i.table} ${i.key}`) },
		})
	const specs = specsCarriedBy(selectedSpecs(options.sections), sections)
	const reports: Partial<Record<MindSectionType, MindSectionReportType>> = {}
	const index = createContentIndex(db)
	const factMap = new Map<string, string>()
	const deferredFacts = new Set<string>()
	const conflicts: string[] = []
	const skippedKeys = new Set<string>()
	const preexisting = dbAdapter.foreignKeyViolations(db)
	const run = db.transaction(() => {
		if (mode === "replace" && replaceTargetDomiaId)
			clearSections(db, specs, replaceTargetDomiaId, reports)
		for (const spec of specs) {
			const section = sections[spec.name]
			if (!section || section.rows.length === 0) continue
			const columns = liveSectionColumns(db, spec.name, section.columns)
			const report = (reports[spec.name] ??= emptyReport())
			report.droppedColumns = section.columns.length - columns.length
			const insert = dbAdapter.rowInserter(db, spec.name)
			for (const original of rowObjects(section)) {
				if (isDeferredRow(original, spec, resolveDomiaId, deferredFacts)) {
					report.deferred += 1
					continue
				}
				const { row, remapped } = remapRow(
					original,
					spec,
					resolveDomiaId,
					factMap,
				)
				if (remapped) report.remapped += 1
				const writable = unredactedColumns(spec, columns, row)
				const existing = findExisting(db, spec, columns, row, index)
				if (existing) {
					const existingId = existing[MIND_ID_COLUMN]
					if (sameContent(spec, columns, existing, row)) report.matched += 1
					else if (
						spec.singleton ||
						spec.activeSingleton ||
						spec.upsertByKey ||
						onConflict === "overwrite"
					) {
						dbAdapter.updateInPlace(db, spec, writable, existingId, row)
						keepSingleActiveProfile(db, spec, row, existingId)
						report.updated += 1
					} else if (onConflict === "skip") {
						skippedKeys.add(rowKey(spec, row))
						report.skipped += 1
					} else
						conflicts.push(
							`${spec.name} ${keyOf(spec, row)}: exists with different content`,
						)
					if (
						spec.name === MIND_FACT_SECTION &&
						existingId !== row[MIND_ID_COLUMN]
					)
						factMap.set(String(row[MIND_ID_COLUMN]), String(existingId))
					continue
				}
				if (
					columns.includes(MIND_ID_COLUMN) &&
					dbAdapter.idExists(db, spec.name, row[MIND_ID_COLUMN])
				) {
					const fresh = generateUuid()
					if (spec.name === MIND_FACT_SECTION)
						factMap.set(String(row[MIND_ID_COLUMN]), fresh)
					row[MIND_ID_COLUMN] = fresh
					report.reidentified += 1
				}
				insert(writable, row)
				keepSingleActiveProfile(db, spec, row, row[MIND_ID_COLUMN])
				report.inserted += 1
			}
		}
		if (conflicts.length > 0)
			throw domiaError(MIND_TRANSFER_ERRORS.IMPORT_CONFLICT, {
				logger: mindTransferLogger,
				meta: { conflicts },
			})
		const after = dbAdapter.foreignKeyViolations(db)
		if (after > preexisting)
			throw domiaError(MIND_TRANSFER_ERRORS.IMPORT_VERIFY_FAILED, {
				logger: mindTransferLogger,
				meta: { foreignKeyViolations: `${preexisting} → ${after}` },
			})
		const issues = verifyMindSections(
			db,
			sections,
			resolveDomiaId,
			options.sections,
			skippedKeys,
		)
		if (issues.length > 0)
			throw domiaError(MIND_TRANSFER_ERRORS.IMPORT_VERIFY_FAILED, {
				logger: mindTransferLogger,
				meta: {
					issues: issues
						.slice(0, 20)
						.map((i) => `${i.table} ${i.key}: ${i.reason}`),
				},
			})
	})
	run()
	return {
		mode,
		sections: reports,
		preexistingForeignKeyViolations: preexisting,
	}
}

export const importMind = (
	domiaId: string,
	bundleInput: unknown,
	{ mode = "merge", onConflict, sections }: MindImportOptionsType = {},
): MindImportReportType => {
	const parsed = mindBundleSchema.safeParse(bundleInput)
	if (!parsed.success)
		throw domiaError(MIND_TRANSFER_ERRORS.BUNDLE_INVALID, {
			logger: mindTransferLogger,
			meta: {
				domiaId,
				issues: parsed.error.issues
					.slice(0, 10)
					.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
			},
		})
	const bundle: MindBundleType = parsed.data
	const db = dbAdapter.coreDb()
	const target = dbAdapter.domiaById(db, domiaId)
	if (!target)
		throw domiaError(MIND_TRANSFER_ERRORS.IDENTITY_NOT_FOUND, {
			logger: mindTransferLogger,
			meta: { domiaId },
		})
	const applied = applyMindSections(db, bundle.sections, {
		sections,
		mode,
		onConflict,
		resolveDomiaId: () => target.id,
		replaceTargetDomiaId: target.id,
	})
	mindTransferLogger.info("📥 mind bundle imported", {
		domiaId,
		mode,
		onConflict: onConflict ?? MIND_DEFAULT_IMPORT_ON_CONFLICT,
		sourceDomiaKey: bundle.sourceDomiaKey,
		targetDomiaKey: target.domiaKey,
	})
	return {
		...applied,
		sourceDomiaKey: bundle.sourceDomiaKey,
		targetDomiaKey: target.domiaKey,
	}
}

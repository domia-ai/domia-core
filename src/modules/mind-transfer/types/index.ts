import type { z } from "zod"

import type { MIND_SECTIONS } from "../constants"
import type {
	mindBundleSchema,
	mindImportModeSchema,
	mindImportOnConflictSchema,
	mindSectionDataSchema,
	mindSectionsSchema,
} from "../schemas"

export type MindSectionType = (typeof MIND_SECTIONS)[number]

export type MindSectionDataType = z.infer<typeof mindSectionDataSchema>

export type MindSectionsType = z.infer<typeof mindSectionsSchema>

export type MindBundleType = z.infer<typeof mindBundleSchema>

export type MindImportModeType = z.infer<typeof mindImportModeSchema>

export type MindImportOnConflictType = z.infer<
	typeof mindImportOnConflictSchema
>

export type MindRowType = Record<string, unknown>

export type MindSectionSpecType = {
	name: MindSectionType
	naturalKey: string[]
	singleton: boolean
	activeSingleton: boolean
	upsertByKey: boolean
}

export type MindIdentityRefType = {
	id: string
	domiaKey: string
}

export type MindDomiaMapType = {
	map: Map<string, string>
	deferredIds: Set<string>
	deferredKeys: string[]
}

export type MindTransferIssueType = {
	table: string
	key: string
	reason: string
}

export type MindSectionReportType = {
	cleared: number
	deferred: number
	inserted: number
	matched: number
	updated: number
	skipped: number
	remapped: number
	reidentified: number
	droppedColumns: number
}

export type MindContentIndexType = (
	spec: MindSectionSpecType,
	columns: string[],
	row: MindRowType,
) => MindRowType | undefined

export type MindResolveDomiaIdType = (
	sourceDomiaId: unknown,
) => string | undefined

export type MindCollectOptionsType = {
	sections?: MindSectionType[]
	redactSecrets?: boolean
}

export type MindExportOptionsType = {
	sections?: MindSectionType[]
}

export type MindApplyOptionsType = {
	sections?: MindSectionType[]
	mode: MindImportModeType
	onConflict?: MindImportOnConflictType
	resolveDomiaId: MindResolveDomiaIdType
	replaceTargetDomiaId?: string
}

export type MindImportOptionsType = {
	mode?: MindImportModeType
	onConflict?: MindImportOnConflictType
	sections?: MindSectionType[]
}

export type MindRowInserterType = (columns: string[], row: MindRowType) => void

export type MindApplyReportType = {
	mode: MindImportModeType
	sections: Partial<Record<MindSectionType, MindSectionReportType>>
	preexistingForeignKeyViolations: number
}

export type MindImportReportType = MindApplyReportType & {
	sourceDomiaKey: string
	targetDomiaKey: string
}

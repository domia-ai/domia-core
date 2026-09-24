import { z } from "zod"

import {
	MIND_BUNDLE_COLUMN_PATTERN,
	MIND_BUNDLE_MAX_COLUMNS,
	MIND_BUNDLE_MAX_ROWS,
	MIND_BUNDLE_VERSION,
	MIND_IMPORT_ON_CONFLICT,
	MIND_SECTIONS,
} from "../constants"

export const mindSectionNameSchema = z.enum(MIND_SECTIONS)

export const mindImportModeSchema = z.enum(["merge", "replace"])

export const mindImportOnConflictSchema = z.enum(MIND_IMPORT_ON_CONFLICT)

export const mindSectionDataSchema = z
	.object({
		columns: z
			.array(z.string().max(64).regex(MIND_BUNDLE_COLUMN_PATTERN))
			.min(1)
			.max(MIND_BUNDLE_MAX_COLUMNS),
		rows: z.array(z.array(z.unknown())).max(MIND_BUNDLE_MAX_ROWS),
	})
	.refine(
		(s) => s.rows.every((r) => r.length === s.columns.length),
		"every row must have one value per column",
	)

const mindSectionsShape = Object.fromEntries(
	MIND_SECTIONS.map((name) => [name, mindSectionDataSchema.optional()]),
) as Record<
	(typeof MIND_SECTIONS)[number],
	z.ZodOptional<typeof mindSectionDataSchema>
>

export const mindSectionsSchema = z.strictObject(mindSectionsShape)

export const mindBundleSchema = z.strictObject({
	version: z.literal(MIND_BUNDLE_VERSION),
	exportedAt: z.string().min(1),
	sourceDomiaKey: z.string().min(1),
	sections: mindSectionsSchema,
})

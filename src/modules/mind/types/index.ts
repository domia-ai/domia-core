import { z } from "zod"

import { mindSnapshotSchema } from "../schemas"

export type MindSnapshotType = z.infer<typeof mindSnapshotSchema>

export type MindTemplateType = {
	id: string
	name: string
	description: string
	mind: MindSnapshotType
}

export type TemplateSummaryType = {
	id: string
	name: string
	description: string
}

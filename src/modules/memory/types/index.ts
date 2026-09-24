import { z } from "zod"

import { factSchema } from "../schemas"

export type RawFactType = z.infer<typeof factSchema> & { explicit?: boolean }

export type UpsertFactsResultType = {
	stored: number
	corroborated: number
	removed: number
	rejected: string[]
}

export type FactValidityType = {
	validFrom: string
	validUntil: string | null
}

export type FactRecallRowType = {
	subject: string
	relation: string
	value: string
	validUntil: string | null
	supersededAt: string | null
}

export type RelationFamilyType =
	| "preference"
	| "ownership"
	| "residence"
	| "occupation"
	| "activity"
	| "identity"
	| "companion"

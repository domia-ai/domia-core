import { readFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import type {
	EvalTurnType,
	SiteEntityType,
	SiteMapType,
	SiteSpeakerType,
} from "../types"

const siteEntitySchema = z
	.object({
		name: z.string().min(1),
		entityId: z.string().min(1),
		area: z.string().min(1),
		token: z.string().min(1),
		spoken: z.string().min(1),
		spokenSingular: z.string().min(1).optional(),
		nameEs: z.string().min(1).optional(),
	})
	.strict()

const siteSpeakerSchema = z
	.object({
		name: z.string().min(1),
		playerId: z.string().min(1),
		spoken: z.string().min(1),
		nameEs: z.string().min(1).optional(),
		satelliteId: z.string().min(1).optional(),
	})
	.strict()

export const siteMapSchema = z
	.object({
		name: z.string().min(1),
		entities: z.record(z.string(), siteEntitySchema),
		speakers: z.record(z.string(), siteSpeakerSchema).optional(),
	})
	.strict()

const SITES_DIR = join(process.cwd(), "evals", "fixtures", "sites")
const PLACEHOLDER_RE =
	/\{\{(entity|speaker)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\}\}/g
const TBD_RE = /^tbd\b/i

export const loadSiteMap = (name: string): SiteMapType => {
	const file = join(SITES_DIR, `${name}.json`)
	const parsed = siteMapSchema.safeParse(
		JSON.parse(readFileSync(file, "utf8")) as unknown,
	)
	if (!parsed.success)
		throw new Error(
			`invalid site map ${file}: ${parsed.error.issues
				.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
				.join("; ")}`,
		)
	return parsed.data
}

export const entityAt = (
	entities: Record<string, SiteEntityType>,
	alias: string,
): SiteEntityType | undefined => entities[alias]

export const aliasEntities = (
	map: SiteMapType,
	aliases?: Record<string, string>,
): Record<string, SiteEntityType> => {
	if (!aliases) return map.entities
	const out: Record<string, SiteEntityType> = { ...map.entities }
	for (const [alias, target] of Object.entries(aliases)) {
		const entity = entityAt(map.entities, target)
		if (!entity)
			throw new Error(
				`site ${map.name} has no entity "${target}" for "${alias}"`,
			)
		out[alias] = entity
	}
	return out
}

const fieldOf = (
	source: SiteEntityType | SiteSpeakerType | undefined,
	field: string,
): string | undefined => {
	const value = (source as Record<string, unknown> | undefined)?.[field]
	return typeof value === "string" && !TBD_RE.test(value) ? value : undefined
}

export const substitutePlaceholders = (
	text: string,
	entities: Record<string, SiteEntityType>,
	speakers?: Record<string, SiteSpeakerType>,
): string =>
	text.replace(
		PLACEHOLDER_RE,
		(whole, kind: string, alias: string, field: string) =>
			fieldOf(
				kind === "speaker" ? speakers?.[alias] : entities[alias],
				field,
			) ?? whole,
	)

export const unresolvedPlaceholders = (text: string): string[] => [
	...new Set(text.match(PLACEHOLDER_RE) ?? []),
]

const substituteDeep = (
	value: unknown,
	entities: Record<string, SiteEntityType>,
	speakers?: Record<string, SiteSpeakerType>,
): unknown => {
	if (typeof value === "string")
		return substitutePlaceholders(value, entities, speakers)
	if (Array.isArray(value))
		return (value as unknown[]).map((v) =>
			substituteDeep(v, entities, speakers),
		)
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([k, v]) => [
				k,
				substituteDeep(v, entities, speakers),
			]),
		)
	return value
}

export const substituteTurn = (
	turn: EvalTurnType,
	entities: Record<string, SiteEntityType>,
	speakers?: Record<string, SiteSpeakerType>,
): EvalTurnType => substituteDeep(turn, entities, speakers) as EvalTurnType

export const turnPlaceholdersLeft = (turn: EvalTurnType): string[] =>
	unresolvedPlaceholders(JSON.stringify(turn))

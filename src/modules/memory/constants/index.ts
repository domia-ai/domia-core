import type { RelationFamilyType } from "../types"
export const MEMORY_FACT_RECALL_LIMIT = 20
export const MEMORY_FACT_CANDIDATE_LIMIT = 60
export const MEMORY_FACT_EXPIRED_CANDIDATE_LIMIT = 20
export const MEMORY_FACT_EXTRACT_MAX = 5
export const DEFAULT_FACT_CONFIDENCE = 0.7
export const MIN_RECALL_CONF_USER = 0.6
export const MIN_RECALL_CONF_PREF = 0.45
export const MIN_RECALL_CONF_OBS = 0.35
export const KB_CANDIDATE_LIMIT = 40
export const KB_RECALL_LIMIT = 8
export const OBSERVATION_QUARANTINE_CONFIDENCE = 0.2
export const CORROBORATION_MIN_DISTINCT_SOURCES = 2
export const CORROBORATED_CONFIDENCE_MARGIN = 0.05
export const FACT_DEDUP_DEFAULT_THRESHOLD = 0.88
export const FACT_DEDUP_RELATION_THRESHOLDS: Record<string, number> = {
	likes: 0.86,
	dislikes: 0.86,
	prefers: 0.86,
	"is named": 0.92,
	"lives in": 0.9,
	"is allergic to": 0.9,
}
const SINGLE_VALUED_FAVORITE_ATTRIBUTES = [
	"color",
	"colour",
	"number",
	"season",
	"drink",
	"team",
	"song",
	"movie",
]

export const SINGLE_VALUED_RELATIONS = new Set([
	...SINGLE_VALUED_FAVORITE_ATTRIBUTES.flatMap((attribute) => [
		`has favorite ${attribute}`,
		`has favourite ${attribute}`,
	]),
	"is named",
	"is called",
	"lives in",
	"lives at",
	"is from",
	"works at",
	"works as",
	"is aged",
	"is married to",
	"was born in",
	"was born on",
	"has birthday",
	"has birthday on",
])
export const TAUGHT_FACT_RELATIONS = new Set([
	...SINGLE_VALUED_RELATIONS,
	"likes",
	"dislikes",
	"prefers",
	"loves",
	"hates",
	"enjoys",
	"is allergic to",
])

export const NEGATIVE_PREFERENCE_RELATIONS = new Set([
	"dislikes",
	"dislike",
	"hates",
	"hate",
	"detests",
	"loathes",
	"despises",
	"cannot stand",
	"can't stand",
	"is not a fan of",
	"is no longer a fan of",
	"avoids",
	"is tired of",
	"is sick of",
])

export const RELATION_ALLOWLIST_RE =
	/^(is|are|has|have|likes?|dislikes?|prefers?|loves?|hates?|enjoys?|owns?|lives?|works?|speaks?|plays?|drinks?|eats?|collects?|studies|studied|teaches?|celebrates?|supports?|was born|wants to (be|become|visit|learn))\b/

export const RELATION_FAMILY_RE: Record<RelationFamilyType, RegExp> = {
	preference:
		/^(likes?|loves?|enjoys?|prefers?|adores?|dislikes?|hates?|is (a )?fan of|has (a |an )?favou?rite\b|favou?rite\b)/,
	ownership: /^(owns?|has (a|an|two|three|\d+)\b|bought|got)/,
	residence: /^(lives?( in| at)?|is from|comes from|moved|was born)/,
	occupation:
		/^(works?( as| at| in)?|is (a|an)\b|studies|studied|teaches?|has (a )?job)/,
	activity:
		/^(plays?|speaks?|collects?|drinks?|eats?|listens?( to)?|watches?|reads?|practices?)/,
	identity: /^(is named|is called|has (the )?name|name is)/,
	companion:
		/^has (a |an )?(dog|cat|pet|son|daughter|kid|child|wife|husband|partner|boyfriend|girlfriend|brother|sister|mother|father)\b/,
}

export const RELATION_FAMILIES = Object.keys(
	RELATION_FAMILY_RE,
) as RelationFamilyType[]

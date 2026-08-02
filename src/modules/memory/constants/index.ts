export const MEMORY_FACT_RECALL_LIMIT = 20
export const MEMORY_FACT_CANDIDATE_LIMIT = 60
export const MEMORY_FACT_EXTRACT_MAX = 5
export const DEFAULT_FACT_CONFIDENCE = 0.7
export const MIN_RECALL_CONFIDENCE = 0.35
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
export const SINGLE_VALUED_RELATIONS = new Set([
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
export const RELATION_ALLOWLIST_RE =
	/^(is|are|has|have|likes?|dislikes?|prefers?|loves?|hates?|enjoys?|owns?|lives?|works?|speaks?|plays?|drinks?|eats?|collects?|studies|studied|teaches?|celebrates?|supports?|was born|wants to (be|become|visit|learn))\b/

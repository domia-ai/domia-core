import { SKILL_PROTOCOL_ENUM } from "@/db/constants/skills"
import type { MindSectionSpecType, MindSectionType } from "../types"

export const MIND_BUNDLE_VERSION = 1

export const MIND_SECTIONS = [
	"emotion_state",
	"character_profile",
	"user_model",
	"memory_fact",
	"fact_evidence",
	"knowledge_entry",
	"memory_episode",
	"emotion_event",
	"proactive_schedule",
	"satellite_config",
	"skill_provider",
	"routine",
] as const

export const MIND_DOMIA_COLUMN = "domia_id"
export const MIND_ID_COLUMN = "id"
export const MIND_ACTIVE_COLUMN = "is_active"
export const MIND_FACT_SECTION = "memory_fact"
export const MIND_EVIDENCE_SECTION = "fact_evidence"
export const MIND_EVIDENCE_FACT_COLUMN = "fact_id"
export const MIND_PROVIDER_SECTION = "skill_provider"
export const MIND_PROVIDER_PROTOCOL_COLUMN = "protocol"
export const MIND_BUILTIN_PROTOCOL = SKILL_PROTOCOL_ENUM.BUILTIN

export const MIND_SECTION_SPECS: MindSectionSpecType[] = [
	{
		name: "emotion_state",
		naturalKey: [MIND_DOMIA_COLUMN],
		singleton: true,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "character_profile",
		naturalKey: [MIND_ID_COLUMN],
		singleton: false,
		activeSingleton: true,
		upsertByKey: false,
	},
	{
		name: "user_model",
		naturalKey: [MIND_DOMIA_COLUMN],
		singleton: true,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: MIND_FACT_SECTION,
		naturalKey: [MIND_DOMIA_COLUMN, "subject", "relation", "value_key"],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: MIND_EVIDENCE_SECTION,
		naturalKey: [MIND_EVIDENCE_FACT_COLUMN, "source_interaction_id"],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "knowledge_entry",
		naturalKey: [MIND_ID_COLUMN],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "memory_episode",
		naturalKey: [MIND_ID_COLUMN],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "emotion_event",
		naturalKey: [MIND_ID_COLUMN],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "proactive_schedule",
		naturalKey: [MIND_ID_COLUMN],
		singleton: false,
		activeSingleton: false,
		upsertByKey: false,
	},
	{
		name: "satellite_config",
		naturalKey: [MIND_DOMIA_COLUMN, "satellite_id"],
		singleton: false,
		activeSingleton: false,
		upsertByKey: true,
	},
	{
		name: MIND_PROVIDER_SECTION,
		naturalKey: [MIND_DOMIA_COLUMN, "name"],
		singleton: false,
		activeSingleton: false,
		upsertByKey: true,
	},
	{
		name: "routine",
		naturalKey: [MIND_DOMIA_COLUMN, "slug"],
		singleton: false,
		activeSingleton: false,
		upsertByKey: true,
	},
]

export const MIND_VOLATILE_COLUMNS = new Set(["updated_at", "last_sync_at"])

export const MIND_SECRET_COLUMNS: Partial<Record<MindSectionType, string[]>> = {
	skill_provider: ["auth"],
	satellite_config: ["encryption_key", "livekit_api_key", "livekit_api_secret"],
}

export const MIND_IMPORT_ON_CONFLICT = ["skip", "overwrite", "fail"] as const
export const MIND_DEFAULT_IMPORT_ON_CONFLICT = "skip"

export const MIND_BUNDLE_MAX_COLUMNS = 200
export const MIND_BUNDLE_MAX_ROWS = 200_000
export const MIND_BUNDLE_COLUMN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

import { DOMIA_BUNDLE_OMIT_KEYS } from "@/modules/config/constants"

export const CONFIG_SCHEMA_HIDDEN_COLUMNS: ReadonlySet<string> = new Set([
	"id",
	"domiaId",
	"createdAt",
	"updatedAt",
	"configRevision",
	"lastSyncAt",
	"isActive",
])

export const CONFIG_SCHEMA_HIDDEN_BY_SECTION: Readonly<
	Partial<Record<string, readonly string[]>>
> = {
	domia: ["name", ...DOMIA_BUNDLE_OMIT_KEYS],
	mqttLocal: ["type"],
}

export const CONFIG_SCHEMA_SECRET_FIELDS: ReadonlySet<string> = new Set([
	"stt.apiKey",
	"llm.apiKey",
	"mqttLocal.password",
])

export const AUTH_EXEMPT_PATHS: ReadonlySet<string> = new Set(["/", "/health"])

export const AUTH_EXEMPT_AUDIO_KINDS: ReadonlySet<string> = new Set([
	"tts",
	"announce",
])

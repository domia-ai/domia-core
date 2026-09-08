export const CONFIG_SCHEMA_HIDDEN_COLUMNS: ReadonlySet<string> = new Set([
	"id",
	"domiaId",
	"createdAt",
	"updatedAt",
	"configRevision",
	"lastSyncAt",
	"isActive",
	"name",
])

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

import { BUILTIN_PROVIDER_NAME } from "@/db"

export const DOMIA_SPECIALIZATION_KIND = BUILTIN_PROVIDER_NAME
export const DOMIA_PACK_BASE_LANGUAGE = "en"
export const DOMIA_TOOL_TIME = "time"
export const DOMIA_TOOL_DATE = "date"
export const DOMIA_TOOL_TIMER = "timer"
export const DOMIA_TOOL_TIMER_CANCEL = "timer_cancel"
export const DOMIA_TOOL_TIMER_STATUS = "timer_status"
export const DOMIA_TOOL_REMINDER = "reminder"
export const DOMIA_TOOL_REPEAT = "repeat"
export const DOMIA_TOOL_CANCEL = "cancel"
export const DOMIA_TOOL_ALARM = "alarm"
export const DOMIA_TOOL_ALARM_CANCEL = "alarm_cancel"
export const DOMIA_TOOL_VOLUME = "volume"
export const DOMIA_TOOL_REMEMBER = "remember"
export const DOMIA_TOOL_FORGET = "forget"
export const DOMIA_CLOCK_SEPARATOR = ":"
export const DOMIA_CLOCK_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/
export const DOMIA_PLACEHOLDER_RE = /\{(\w+)\}/g
export const DOMIA_ROUTINE_MIN_TIMEOUT_MS = 1
export const DOMIA_ROUTINE_REPLY_PLACEHOLDER_ARG = "speakable"
export const DOMIA_ROUTINE_UNSUPPORTED_SLOT_KINDS = new Set([
	"context",
	"schemaEnum",
])
export const DOMIA_VOLUME_MIN = 0
export const DOMIA_VOLUME_MAX = 100
export const DOMIA_VOLUME_DIRECTION_ENUM = {
	UP: "up",
	DOWN: "down",
} as const
export const DOMIA_VOLUME_DIRECTION_ENUM_VALUES = [
	DOMIA_VOLUME_DIRECTION_ENUM.UP,
	DOMIA_VOLUME_DIRECTION_ENUM.DOWN,
] as const
export const DOMIA_FACT_SUBJECT_MAX_CHARS = 60
export const DOMIA_FACT_RELATION_MAX_CHARS = 60
export const DOMIA_FACT_VALUE_MAX_CHARS = 200
export const DOMIA_FORGET_TOPIC_MAX_CHARS = 200
export const DOMIA_TIMER_MIN_SECONDS = 1
export const DOMIA_TIMER_MAX_SECONDS = 86_400
export const DOMIA_REMINDER_MAX_SECONDS = 2_592_000
export const DOMIA_REMINDER_TEXT_MAX_CHARS = 500
export const DOMIA_TIMER_LABEL_MAX_CHARS = 80
export const DOMIA_REMINDER_ACTION_ENUM = {
	SET: "set",
	CANCEL: "cancel",
} as const
export const DOMIA_REMINDER_ACTION_ENUM_VALUES = [
	DOMIA_REMINDER_ACTION_ENUM.SET,
	DOMIA_REMINDER_ACTION_ENUM.CANCEL,
] as const
export const DOMIA_READ_HINTS = {
	readOnlyHint: true,
	openWorldHint: false,
	idempotentHint: true,
} as const
export const DOMIA_WRITE_HINTS = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
} as const
export const DOMIA_DESTRUCTIVE_HINTS = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: false,
} as const

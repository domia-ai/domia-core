import type {
	PROACTIVE_IMPORTANCE_ENUM_VALUES,
	PROACTIVE_VERB_ENUM_VALUES,
	PROACTIVE_SCHEDULE_STATUS_ENUM_VALUES,
	PROACTIVE_TARGET_KIND_ENUM_VALUES,
	InsertProactiveScheduleType,
	SelectProactiveScheduleType,
	SelectModuleSettingsType,
} from "@/db"
import type { DomiaType } from "@/modules/core"

export type ProactiveImportanceType =
	(typeof PROACTIVE_IMPORTANCE_ENUM_VALUES)[number]

export type ProactiveVerbType = (typeof PROACTIVE_VERB_ENUM_VALUES)[number]

export type ProactiveScheduleStatusType =
	(typeof PROACTIVE_SCHEDULE_STATUS_ENUM_VALUES)[number]

export type ProactiveTargetKindType =
	(typeof PROACTIVE_TARGET_KIND_ENUM_VALUES)[number]

export type ProactiveGateReasonType =
	| "ok"
	| "engine-off"
	| "nudge-off"
	| "quiet-hours"
	| "budget-hour"
	| "budget-day"
	| "rate-limit"
	| "no-activity"
	| "idle-not-reached"
	| "already-nudged"
	| "busy"
	| "no-delivery"
	| "lease-lost"

export type ProactiveBudgetType = {
	hourUsed: number
	hourMax: number
	dayUsed: number
	dayMax: number
}

export type LazyProactiveBudgetType =
	| ProactiveBudgetType
	| (() => ProactiveBudgetType)

export type ProactiveGateInputType = {
	engineOn: boolean
	importance: ProactiveImportanceType
	inQuietHours: boolean
	budget: LazyProactiveBudgetType
}

export type IdleNudgeInputType = {
	engineOn: boolean
	enabled: boolean
	now: number
	lastActivityAt: number | null
	nudgedForActivityAt: number | null
	idleAfterMs: number
	lastNudgeAt: number | null
	minIntervalMs: number
	inQuietHours: boolean
	budget: LazyProactiveBudgetType
}

export type IdleNudgeDecisionType = {
	fire: boolean
	reason: ProactiveGateReasonType
	idleForMs: number | null
}

export type RetryDecisionType =
	| { status: "pending"; dueAt: string; attempts: number }
	| { status: "failed"; attempts: number }

export type ScheduleRecurrenceType = {
	repeatEveryMs: number | null
	repeatDailyAt: string | null
}

export type QuietHoursType = {
	start: string | null
	end: string | null
}

export type ProactiveActivityType = {
	at: number
	satelliteId: string | null
}

export type ProactiveDeliveryOutcomeType = {
	delivered: boolean
	target: string
	listening: boolean
	reason: ProactiveGateReasonType
	audioId?: string
}

export type ProactiveEngineHandleType = {
	domiaKey: string
	domiaId: string
	timer: ReturnType<typeof setInterval>
	wake: ReturnType<typeof setTimeout> | null
	wakeAt: number | null
	tickMs: number
	inFlight: boolean
	cancelled: boolean
	nudgedForActivityAt: number | null
	lastNudgeAt: number | null
	lastTickAt: number | null
	lastOutcome: string | null
}

export type CreateScheduleInputType = Omit<
	InsertProactiveScheduleType,
	| "id"
	| "domiaId"
	| "status"
	| "leaseUntil"
	| "leaseOwner"
	| "attempts"
	| "firedCount"
	| "lastFiredAt"
	| "lastError"
	| "createdAt"
	| "updatedAt"
>

export type ScheduleSummaryType = {
	pending: number
	leased: number
	done: number
	failed: number
	cancelled: number
	nextDueAt: string | null
}

export type ProactivityStatusType = {
	domiaKey: string
	engine: boolean
	running: boolean
	busy: boolean
	quietHours: QuietHoursType & { active: boolean }
	budget: ProactiveBudgetType
	idleNudge: {
		enabled: boolean
		idleAfterMs: number
		minIntervalMs: number
		lastActivityAt: string | null
		lastActivitySatelliteId: string | null
		idleForMs: number | null
		armed: boolean
		lastNudgeAt: string | null
		decision: ProactiveGateReasonType
	}
	schedule: ScheduleSummaryType
	lastTickAt: string | null
	lastOutcome: string | null
}

export type ScheduleItemType = SelectProactiveScheduleType

export type ScheduleDeliveredEventType = {
	domia: DomiaType
	item: ScheduleItemType
	target: string
	satelliteId: string | null
}

export type ScheduleDeliveredListenerType = (
	event: ScheduleDeliveredEventType,
) => void

export type ScheduleReconcileSettingsType = Pick<
	SelectModuleSettingsType,
	"proactiveDeferMaxMs" | "proactiveCriticalDeferMaxMs"
>

export type ScheduleReconcileVerdictType =
	| { kind: "deliver"; late: boolean }
	| { kind: "already-fired" }
	| { kind: "missed" }

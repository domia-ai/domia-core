import { parseClock } from "@/utils"

import { PROACTIVE_BROADCAST_PREFIX } from "../constants"
import type { RetryDecisionType, ScheduleRecurrenceType } from "../types"

export const nextDueAt = (
	recurrence: ScheduleRecurrenceType,
	firedAt: Date,
): string | null => {
	if (recurrence.repeatEveryMs !== null && recurrence.repeatEveryMs > 0)
		return new Date(firedAt.getTime() + recurrence.repeatEveryMs).toISOString()
	const dailyMin = parseClock(recurrence.repeatDailyAt)
	if (dailyMin !== null) {
		const next = new Date(firedAt)
		next.setHours(Math.floor(dailyMin / 60), dailyMin % 60, 0, 0)
		while (next.getTime() <= firedAt.getTime()) next.setDate(next.getDate() + 1)
		return next.toISOString()
	}
	return null
}

export const retryDecision = (
	attemptsSoFar: number,
	maxAttempts: number,
	backoffMs: number,
	now: Date,
): RetryDecisionType => {
	const attempts = attemptsSoFar + 1
	if (attempts >= maxAttempts) return { status: "failed", attempts }
	return {
		status: "pending",
		attempts,
		dueAt: new Date(now.getTime() + backoffMs).toISOString(),
	}
}

export const isLeaseExpired = (leaseUntil: string | null, now: Date): boolean =>
	leaseUntil === null || Date.parse(leaseUntil) <= now.getTime()

export const broadcastIdFor = (scheduleId: string): string =>
	`${PROACTIVE_BROADCAST_PREFIX}${scheduleId}`

export const isProactiveBroadcastId = (broadcastId: string): boolean =>
	broadcastId.startsWith(PROACTIVE_BROADCAST_PREFIX)

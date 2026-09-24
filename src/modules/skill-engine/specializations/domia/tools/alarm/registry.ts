import type {
	BuiltinToolContextType,
	SkillRuntimeTimerStartResultType,
} from "../../../../types"
import { DOMIA_CLOCK_SEPARATOR, DOMIA_TIMER_MIN_SECONDS } from "../../constants"

export const secondsUntil = (due: Date, now: Date): number =>
	Math.max(
		DOMIA_TIMER_MIN_SECONDS,
		Math.round((due.getTime() - now.getTime()) / 1000),
	)

export const nextClockOccurrence = (clock: string, now: Date): Date => {
	const [hours, minutes] = clock.split(DOMIA_CLOCK_SEPARATOR).map(Number)
	const due = new Date(now)
	due.setHours(hours, minutes, 0, 0)
	if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1)
	return due
}

export const startAlarm = (
	ctx: BuiltinToolContextType,
	now: Date,
	due: Date,
	at: string,
	daily: boolean,
	label: string,
	spokenTime: string,
): Promise<SkillRuntimeTimerStartResultType> =>
	ctx.runtime.timers.start({
		domia: ctx.domia,
		origin: ctx.origin,
		seconds: secondsUntil(due, now),
		label,
		kind: "alarm",
		dueAt: due.toISOString(),
		repeatDailyAt: daily ? at : null,
		templateParams: { time: spokenTime },
	})

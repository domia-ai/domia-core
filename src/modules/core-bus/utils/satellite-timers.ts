import { generateUuid, domiaBusLogger } from "@/utils"
import { getSatelliteControl } from "./satellite-registry"
import type {
	ActiveTimerType,
	SatelliteTimerEventType,
	TimerIntentType,
} from "../types"

const timers = new Map<string, ActiveTimerType>()

const TIMER_KEYWORDS = /\b(timer|temporizador|alarm|alarma)\b/i
const NUMBER_WORDS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	fifteen: 15,
	twenty: 20,
	thirty: 30,
	sixty: 60,
	un: 1,
	una: 1,
	dos: 2,
	tres: 3,
	cuatro: 4,
	cinco: 5,
	seis: 6,
	siete: 7,
	ocho: 8,
	nueve: 9,
	diez: 10,
	quince: 15,
	veinte: 20,
	treinta: 30,
	sesenta: 60,
}
const UNIT_SECONDS: { re: RegExp; mult: number }[] = [
	{ re: /\b(hours?|horas?|hr|hrs)\b/i, mult: 3600 },
	{ re: /\b(minutes?|minutos?|mins?|min)\b/i, mult: 60 },
	{ re: /\b(seconds?|segundos?|secs?|sec)\b/i, mult: 1 },
]

export const parseTimerIntent = (text: string): TimerIntentType | null => {
	if (!TIMER_KEYWORDS.test(text)) return null
	const lower = text.toLowerCase()
	const numMatch = lower.match(/(\d+)/)
	let amount = numMatch ? Number(numMatch[1]) : null
	if (amount === null) {
		for (const [word, val] of Object.entries(NUMBER_WORDS)) {
			if (new RegExp(`\\b${word}\\b`).test(lower)) {
				amount = val
				break
			}
		}
	}
	if (amount === null || amount <= 0) return null
	const unit = UNIT_SECONDS.find((u) => u.re.test(lower))
	const mult = unit ? unit.mult : 60
	const seconds = amount * mult
	if (seconds <= 0 || seconds > 86400) return null
	const unitLabel = mult === 3600 ? "hour" : mult === 60 ? "minute" : "second"
	const label = `${amount} ${unitLabel}${amount === 1 ? "" : "s"} timer`
	return { seconds, label }
}

const emit = (
	domiaKey: string,
	satelliteId: string,
	event: SatelliteTimerEventType,
): void => {
	const control = getSatelliteControl(domiaKey, satelliteId)
	control?.sendTimerEvent?.(event)
}

export const startSatelliteTimer = (
	domiaKey: string,
	satelliteId: string,
	name: string,
	seconds: number,
): ActiveTimerType => {
	const timerId = generateUuid()
	const handle = setTimeout(() => {
		emit(domiaKey, satelliteId, {
			eventType: "finished",
			timerId,
			name,
			totalSeconds: seconds,
			secondsLeft: 0,
			isActive: false,
		})
		timers.delete(timerId)
	}, seconds * 1000)
	handle.unref?.()
	const timer: ActiveTimerType = {
		timerId,
		domiaKey,
		satelliteId,
		name,
		totalSeconds: seconds,
		startedAt: Date.now(),
		handle,
	}
	timers.set(timerId, timer)
	emit(domiaKey, satelliteId, {
		eventType: "started",
		timerId,
		name,
		totalSeconds: seconds,
		secondsLeft: seconds,
		isActive: true,
	})
	domiaBusLogger.info(`⏲️ satellite timer started (${name}, ${seconds}s)`, {
		domiaKey,
		satelliteId,
		timerId,
	})
	return timer
}

export const cancelSatelliteTimer = (timerId: string): boolean => {
	const timer = timers.get(timerId)
	if (!timer) return false
	clearTimeout(timer.handle)
	timers.delete(timerId)
	emit(timer.domiaKey, timer.satelliteId, {
		eventType: "cancelled",
		timerId,
		name: timer.name,
		totalSeconds: timer.totalSeconds,
		secondsLeft: Math.max(
			0,
			timer.totalSeconds - Math.round((Date.now() - timer.startedAt) / 1000),
		),
		isActive: false,
	})
	return true
}

export const listSatelliteTimers = (
	domiaKey: string,
	satelliteId: string,
): ActiveTimerType[] =>
	[...timers.values()].filter(
		(t) => t.domiaKey === domiaKey && t.satelliteId === satelliteId,
	)

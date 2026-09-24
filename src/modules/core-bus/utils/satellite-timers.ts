import { PROACTIVE_TEMPLATE_KEY_ENUM } from "@/db"
import { getOwnDomia } from "@/modules/core"
import { runtimePort, type SkillRuntimeTimerType } from "@/modules/skill-engine"
import { domiaBusLogger } from "@/utils"

import { getSatelliteControl } from "./satellite-registry"
import type { ActiveTimerType } from "../types"

const HTTP_SOURCE = "http"

const toActiveTimer = (
	domiaKey: string,
	satelliteId: string,
	timer: SkillRuntimeTimerType,
	remaining: number,
): ActiveTimerType => ({
	timerId: timer.id,
	domiaKey,
	satelliteId,
	name: timer.label,
	totalSeconds: timer.totalSeconds,
	secondsLeft: remaining,
})

export const startSatelliteTimer = async (
	domiaKey: string,
	satelliteId: string,
	name: string,
	seconds: number,
): Promise<ActiveTimerType | null> => {
	const domia = await getOwnDomia(domiaKey)
	if (!domia) return null
	const port = runtimePort()
	const origin = port.originCapabilities(domia, satelliteId, HTTP_SOURCE)
	const result = await port.timers.start({
		domia,
		origin,
		seconds,
		label: name,
		kind: "timer",
	})
	domiaBusLogger.info(`⏲️ satellite timer started (${name}, ${seconds}s)`, {
		domiaKey,
		satelliteId,
		timerId: result.timer.id,
	})
	return toActiveTimer(domiaKey, satelliteId, result.timer, seconds)
}

export const cancelSatelliteTimer = async (
	domiaKey: string,
	timerId: string,
): Promise<boolean> => {
	const domia = await getOwnDomia(domiaKey)
	if (!domia) return false
	const row = await runtimePort().schedule.cancel(domia, timerId)
	if (!row) return false
	const mirrorTo =
		row.templateKey === PROACTIVE_TEMPLATE_KEY_ENUM.TIMER_FINISHED
			? row.targetSatelliteId
			: null
	if (!mirrorTo) return true
	const remaining = Math.max(
		0,
		Math.round((Date.parse(row.dueAt) - Date.now()) / 1000),
	)
	try {
		getSatelliteControl(domiaKey, mirrorTo)?.sendTimerEvent?.({
			eventType: "cancelled",
			timerId: row.id,
			name: row.templateParams?.label ?? row.name,
			totalSeconds: Number(row.templateParams?.totalSeconds ?? remaining),
			secondsLeft: remaining,
			isActive: false,
		})
	} catch (err) {
		domiaBusLogger.warn("satellite timer cancel mirror failed", {
			domiaKey,
			satelliteId: mirrorTo,
			timerId,
			err,
		})
	}
	return true
}

export const listSatelliteTimers = async (
	domiaKey: string,
	satelliteId: string,
): Promise<ActiveTimerType[]> => {
	const domia = await getOwnDomia(domiaKey)
	if (!domia) return []
	const port = runtimePort()
	const origin = port.originCapabilities(domia, satelliteId, HTTP_SOURCE)
	const timers = await port.timers.list(domia, origin, "timer")
	return timers.map((t) =>
		toActiveTimer(domiaKey, satelliteId, t, port.timers.remaining(t)),
	)
}

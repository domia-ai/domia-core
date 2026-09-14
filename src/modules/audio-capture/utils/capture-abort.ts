import { audioCaptureLogger } from "@/utils"
import type { StopSoxType } from "../types"

const stoppers = new Map<string, Set<StopSoxType>>()
const abortedCaptures = new Set<string>()

export const registerCaptureStop = (
	domiaId: string,
	stop: StopSoxType,
): (() => void) => {
	const set = stoppers.get(domiaId) ?? new Set<StopSoxType>()
	stoppers.set(domiaId, set)
	set.add(stop)
	return () => {
		set.delete(stop)
		if (set.size === 0 && stoppers.get(domiaId) === set)
			stoppers.delete(domiaId)
	}
}

export const abortActiveCapture = (
	domiaId: string,
	reason: string,
): boolean => {
	abortedCaptures.add(domiaId)
	const set = stoppers.get(domiaId)
	if (!set || set.size === 0) return false
	audioCaptureLogger.info(`[🎙️] aborting active capture (${reason})`, {
		domiaId,
	})
	for (const stop of [...set]) stop(reason)
	if (stoppers.get(domiaId) === set) stoppers.delete(domiaId)
	return true
}

export const clearCaptureAbort = (domiaId: string): void => {
	abortedCaptures.delete(domiaId)
}

export const consumeCaptureAbort = (domiaId: string): boolean =>
	abortedCaptures.delete(domiaId)

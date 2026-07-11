import type { PlaybackControlsType } from "../types"

const activePlaybacks = new Map<string, Set<() => void>>()
const activeControls = new Map<string, Set<PlaybackControlsType>>()

export const registerActivePlayback = (
	domiaId: string,
	stop: () => void,
	controls?: PlaybackControlsType,
): (() => void) => {
	const stops = activePlaybacks.get(domiaId) ?? new Set()
	stops.add(stop)
	activePlaybacks.set(domiaId, stops)
	const ctrls = activeControls.get(domiaId) ?? new Set()
	if (controls) {
		ctrls.add(controls)
		activeControls.set(domiaId, ctrls)
	}
	return () => {
		stops.delete(stop)
		if (stops.size === 0) activePlaybacks.delete(domiaId)
		if (controls) {
			ctrls.delete(controls)
			if (ctrls.size === 0) activeControls.delete(domiaId)
		}
	}
}

export const hasActivePlayback = (domiaId: string): boolean =>
	(activePlaybacks.get(domiaId)?.size ?? 0) > 0

export const stopActivePlayback = (domiaId: string): boolean => {
	const stops = activePlaybacks.get(domiaId)
	if (!stops || stops.size === 0) return false
	for (const stop of [...stops]) stop()
	return true
}

export const pauseActivePlayback = (domiaId: string): boolean => {
	const ctrls = activeControls.get(domiaId)
	if (!ctrls || ctrls.size === 0) return false
	let paused = false
	for (const c of [...ctrls]) if (c.pause()) paused = true
	return paused
}

export const resumeActivePlayback = (domiaId: string): boolean => {
	const ctrls = activeControls.get(domiaId)
	if (!ctrls || ctrls.size === 0) return false
	let resumed = false
	for (const c of [...ctrls]) if (c.resume()) resumed = true
	return resumed
}

export const activePlaybackPositionMs = (domiaId: string): number | null => {
	const ctrls = activeControls.get(domiaId)
	if (!ctrls) return null
	for (const c of ctrls) {
		const pos = c.positionMs()
		if (pos !== null) return pos
	}
	return null
}

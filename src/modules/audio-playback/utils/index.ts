const activePlaybacks = new Map<string, Set<() => void>>()

export const registerActivePlayback = (
	domiaId: string,
	stop: () => void,
): (() => void) => {
	const stops = activePlaybacks.get(domiaId) ?? new Set()
	stops.add(stop)
	activePlaybacks.set(domiaId, stops)
	return () => {
		stops.delete(stop)
		if (stops.size === 0) activePlaybacks.delete(domiaId)
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

import { stopActivePlayback } from "@/modules/audio-playback"
import { domiaBusLogger } from "@/utils"
import { clearStreamingSink } from "./streaming-sink"
import type { TurnScopeType } from "../types"

const turns = new Map<string, TurnScopeType>()
const abortedInteractions = new Set<string>()
const ABORTED_TOMBSTONE_MAX = 512

const rememberAbort = (interactionId: string): void => {
	abortedInteractions.add(interactionId)
	if (abortedInteractions.size > ABORTED_TOMBSTONE_MAX) {
		const oldest = abortedInteractions.values().next().value
		if (oldest !== undefined) abortedInteractions.delete(oldest)
	}
}

export const beginTurn = (
	domiaId: string,
	interactionId: string,
): TurnScopeType => {
	const existing = turns.get(domiaId)
	if (existing) existing.abort("superseded")
	abortedInteractions.delete(interactionId)

	const controller = new AbortController()
	let abortReason: string | null = null

	const scope: TurnScopeType = {
		domiaId,
		interactionId,
		signal: controller.signal,
		aborted: () => controller.signal.aborted,
		reason: () => abortReason,
		abort: (reason) => {
			if (controller.signal.aborted) return
			abortReason = reason
			rememberAbort(interactionId)
			controller.abort()
			stopActivePlayback(domiaId)
			clearStreamingSink(interactionId)
			domiaBusLogger.info(`🛑 turn aborted (${reason})`, {
				domiaId,
				interactionId,
			})
		},
		end: () => {
			if (turns.get(domiaId) === scope) turns.delete(domiaId)
		},
	}

	turns.set(domiaId, scope)
	return scope
}

export const getActiveTurn = (domiaId: string): TurnScopeType | null =>
	turns.get(domiaId) ?? null

export const abortActiveTurn = (domiaId: string, reason: string): boolean => {
	const scope = turns.get(domiaId)
	if (!scope) return false
	scope.abort(reason)
	return true
}

export const isTurnAborted = (
	domiaId: string,
	interactionId: string,
): boolean => {
	if (abortedInteractions.has(interactionId)) return true
	const scope = turns.get(domiaId)
	if (!scope) return false
	if (scope.interactionId !== interactionId) return true
	return scope.aborted()
}

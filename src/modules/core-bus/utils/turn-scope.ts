import { stopActivePlayback } from "@/modules/audio-playback"
import { domiaBusLogger } from "@/utils"
import { clearStreamingSink } from "./streaming-sink"
import type { TurnScopeType } from "../types"

const turns = new Map<string, TurnScopeType>()

export const beginTurn = (
	domiaId: string,
	interactionId: string,
): TurnScopeType => {
	const existing = turns.get(domiaId)
	if (existing) existing.abort("superseded")

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
	const scope = turns.get(domiaId)
	if (!scope) return false
	if (scope.interactionId !== interactionId) return true
	return scope.aborted()
}

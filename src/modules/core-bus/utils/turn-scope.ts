import {
	stopActivePlayback,
	pauseActivePlayback,
	resumeActivePlayback,
} from "@/modules/audio-playback"
import { getStreamingSink } from "./streaming-sink"
import { domiaBusLogger } from "@/utils"
import { clearStreamingSink } from "./streaming-sink"
import { recordImplicitFeedback } from "@/modules/session-manager"
import { IMPLICIT_FEEDBACK_ENUM } from "@/db"
const pausedTurns = new Set<string>()
import type { PlaybackLedgerType, TurnScopeType } from "../types"

const turns = new Map<string, TurnScopeType>()
const ledgers = new Map<string, PlaybackLedgerType>()

export const registerTurnLedger = (
	interactionId: string,
	ledger: PlaybackLedgerType,
): void => {
	if (ledgers.size > 64) {
		const oldest = ledgers.keys().next().value
		if (oldest) ledgers.delete(oldest)
	}
	ledgers.set(interactionId, ledger)
}

export const getTurnLedger = (
	interactionId: string,
): PlaybackLedgerType | null => ledgers.get(interactionId) ?? null
const abortedInteractions = new Set<string>()
const ABORTED_TOMBSTONE_MAX = 512
const ABORT_WATCHDOG_MS = 5000

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
	if (existing?.interactionId === interactionId) return existing
	if (existing) existing.abort("superseded")
	abortedInteractions.delete(interactionId)

	const controller = new AbortController()
	let abortReason: string | null = null
	let resolveSettled: () => void = () => undefined
	const settled = new Promise<void>((resolve) => {
		resolveSettled = resolve
	})

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
			pausedTurns.delete(domiaId)
			ledgers.get(interactionId)?.releaseGate()
			stopActivePlayback(domiaId)
			clearStreamingSink(interactionId)
			domiaBusLogger.info(`🛑 turn aborted (${reason})`, {
				domiaId,
				interactionId,
			})
			setTimeout(() => {
				if (turns.get(domiaId) === scope) {
					domiaBusLogger.warn(
						`⏱️ turn still not finished ${ABORT_WATCHDOG_MS}ms after abort (${reason}) — a stage is surviving the interrupt`,
						{ domiaId, interactionId },
					)
				}
			}, ABORT_WATCHDOG_MS).unref()
		},
		end: () => {
			if (turns.get(domiaId) === scope) turns.delete(domiaId)
			ledgers.delete(interactionId)
			resolveSettled()
		},
		settled,
	}

	turns.set(domiaId, scope)
	return scope
}

export const getActiveTurn = (domiaId: string): TurnScopeType | null =>
	turns.get(domiaId) ?? null

export const abortActiveTurn = (domiaId: string, reason: string): boolean => {
	const scope = turns.get(domiaId)
	if (!scope) return false
	if (reason.includes("bargein")) {
		recordImplicitFeedback(scope.interactionId, IMPLICIT_FEEDBACK_ENUM.BARGE_IN)
	}
	scope.abort(reason)
	return true
}

export const pauseActiveTurn = (domiaId: string, reason: string): boolean => {
	const scope = turns.get(domiaId)
	if (!scope || scope.aborted() || pausedTurns.has(domiaId)) return false
	const sink = getStreamingSink(scope.interactionId)
	let paused = false
	if (sink?.capabilities?.pause && sink.pause) {
		paused = sink.pause() === true
	}
	if (!paused) paused = pauseActivePlayback(domiaId)
	if (!paused) return false
	ledgers.get(scope.interactionId)?.pause()
	pausedTurns.add(domiaId)
	domiaBusLogger.info(`⏸️ turn paused (${reason})`, {
		domiaId,
		interactionId: scope.interactionId,
	})
	return true
}

export const resumeActiveTurn = (domiaId: string): boolean => {
	if (!pausedTurns.delete(domiaId)) return false
	const scope = turns.get(domiaId)
	if (scope) {
		const sink = getStreamingSink(scope.interactionId)
		const resumed = sink?.resume?.() === true
		if (!resumed) resumeActivePlayback(domiaId)
		ledgers.get(scope.interactionId)?.resume()
		domiaBusLogger.info(`▶️ turn resumed`, {
			domiaId,
			interactionId: scope.interactionId,
		})
	}
	return true
}

export const isTurnPaused = (domiaId: string): boolean =>
	pausedTurns.has(domiaId)

export const abortAndWait = async (
	domiaId: string,
	reason: string,
	timeoutMs = ABORT_WATCHDOG_MS,
): Promise<boolean> => {
	const scope = turns.get(domiaId)
	if (!scope) return true
	scope.abort(reason)
	const timeout = new Promise<"timeout">((resolve) => {
		setTimeout(() => resolve("timeout"), timeoutMs).unref()
	})
	const outcome = await Promise.race([scope.settled, timeout])
	if (outcome === "timeout") {
		domiaBusLogger.warn(
			`⏱️ abortAndWait(${reason}) — turn did not settle within ${timeoutMs}ms`,
			{ domiaId, interactionId: scope.interactionId },
		)
		return false
	}
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

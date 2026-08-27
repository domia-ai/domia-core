import { satelliteEsphomeLogger as logger } from "@/utils"

import type {
	RunControllerDepsType,
	RunControllerType,
	RunPhaseType,
	PlaybackItemType,
} from "../types"

const MEDIA_PLAYING_STATES = new Set([2, 4])
const PLAYBACK_QUEUE_MAX_DEPTH = 4
const PLAYBACK_ITEM_TTL_MS = 30_000
const PLAYBACK_FALLBACK_EXTRA_MS = 5_000
const ERROR_NO_TEXT = "stt-no-text-recognized"
const ERROR_DUPLICATE = "duplicate_wake_up_detected"

export const createEsphomeRunController = (
	deps: RunControllerDepsType,
): RunControllerType => {
	let disposed = false
	let phase: RunPhaseType = "idle"
	let runGeneration = 0
	let playbackGeneration = 0
	let followUpRun = false
	let nextRunIsFollowUp = false
	let transcriptChars = 0
	let phaseTimer: ReturnType<typeof setTimeout> | null = null

	const queue: PlaybackItemType[] = []
	let activePlayback: PlaybackItemType | null = null
	let announcingObserved = false
	let playbackFallbackTimer: ReturnType<typeof setTimeout> | null = null
	let drainTimer: ReturnType<typeof setTimeout> | null = null

	const log = (msg: string, extra?: Record<string, unknown>) =>
		logger.info(`🎛️ ${msg}`, { satelliteId: deps.satelliteId, phase, ...extra })

	const clearPhaseTimer = (): void => {
		if (phaseTimer) clearTimeout(phaseTimer)
		phaseTimer = null
	}

	const armPhaseTimer = (ms: number, onExpiry: () => void): void => {
		clearPhaseTimer()
		const gen = runGeneration
		phaseTimer = setTimeout(() => {
			if (disposed || gen !== runGeneration) return
			onExpiry()
		}, ms)
		phaseTimer.unref?.()
	}

	const setPhase = (next: RunPhaseType): void => {
		phase = next
		clearPhaseTimer()
	}

	const sendError = (code: string, message: string): void => {
		deps.sendEvent(deps.events.error, [
			{ name: "code", value: code },
			{ name: "message", value: message },
		])
	}

	let terminatedGeneration = -1

	const terminateRun = (
		reason: string,
		opts: {
			cancelBackend?: boolean
			emitRunEnd?: boolean
			errorCode?: string
		} = {},
	): void => {
		const gen = runGeneration
		if (phase === "idle" || terminatedGeneration === gen) return
		terminatedGeneration = gen
		log("run closed", { reason, runGeneration: gen })
		runGeneration++
		transcriptChars = 0
		followUpRun = false
		setPhase("idle")
		if (opts.errorCode) sendError(opts.errorCode, reason)
		if (opts.emitRunEnd) deps.sendEvent(deps.events.runEnd)
		deps.onRunClosed()
		if (opts.cancelBackend) deps.onRunCancelled(reason)
		dispatchNext()
	}

	const closeRun = (reason: string): void => terminateRun(reason)

	const recoverStuckRun = (where: string): void => {
		log("⚠️ run watchdog fired — recovering", { where })
		if (phase === "playback") {
			deps.stopMedia()
			invalidatePlayback("watchdog")
			terminateRun(`watchdog:${where}`, { cancelBackend: true })
			return
		}
		terminateRun(`watchdog:${where}`, {
			cancelBackend: true,
			emitRunEnd: true,
			errorCode: "run-timeout",
		})
	}

	const armListeningWatchdog = (extraMs = 0): void => {
		const noSpeechMs =
			(followUpRun
				? deps.budgets.followUpNoSpeechMs
				: deps.budgets.listeningMaxMs) + extraMs
		armPhaseTimer(noSpeechMs, () => {
			if (phase !== "listening") return
			if (followUpRun && transcriptChars === 0) {
				if (deps.hasPendingSpeech?.()) {
					log("voice detected but no transcript yet — extending window")
					armPhaseTimer(2000, () => {
						if (phase !== "listening") return
						if (transcriptChars === 0) {
							terminateRun("followup-empty", {
								cancelBackend: true,
								emitRunEnd: true,
								errorCode: ERROR_NO_TEXT,
							})
						}
					})
					return
				}
				log("empty follow-up window — closing silently")
				terminateRun("followup-empty", {
					cancelBackend: true,
					emitRunEnd: true,
					errorCode: ERROR_NO_TEXT,
				})
				return
			}
			recoverStuckRun("listening")
		})
	}

	const onRequest = (start: boolean): void => {
		if (disposed) return
		if (!start) {
			log("device stop request — cancelling run")
			deps.stopMedia()
			invalidatePlayback("device-stop")
			terminateRun("device-stop", { cancelBackend: true })
			return
		}
		if (phase === "listening" || phase === "processing") {
			log("⚠️ duplicate start request while run active — rejecting both sides")
			deps.respondToRequest(false)
			terminateRun("duplicate-start", {
				cancelBackend: true,
				emitRunEnd: true,
				errorCode: ERROR_DUPLICATE,
			})
			return
		}
		let extraWindowMs = 0
		const rearming =
			nextRunIsFollowUp && activePlayback !== null && activePlayback.followUp
		if (rearming && activePlayback) {
			const started = activePlayback.startedAt ?? activePlayback.enqueuedAt
			extraWindowMs = activePlayback.durationMs
				? Math.max(0, started + activePlayback.durationMs - Date.now())
				: 0
		} else if (activePlayback || queue.length) {
			deps.stopMedia()
			invalidatePlayback("barge-in")
		}
		runGeneration++
		transcriptChars = 0
		followUpRun = nextRunIsFollowUp
		nextRunIsFollowUp = false
		deps.respondToRequest(false)
		deps.sendEvent(deps.events.runStart)
		deps.sendEvent(deps.events.sttStart)
		setPhase("listening")
		armListeningWatchdog(extraWindowMs)
		deps.onRunAccepted(
			followUpRun,
			(followUpRun ? deps.budgets.followUpNoSpeechMs : 0) + extraWindowMs,
			followUpRun && extraWindowMs > 0
				? extraWindowMs + deps.budgets.drainMarginMs
				: 0,
		)
		log("run open", { followUpRun, runGeneration })
	}

	const onTranscript = (text: string): void => {
		if (phase !== "listening" && phase !== "processing") {
			if (text.trim().length === 0) return
			log("transcript arrived after run close — reopening processing", {})
			setPhase("processing")
		}
		transcriptChars = text.trim().length
		if (transcriptChars > 0)
			deps.sendEvent(deps.events.sttEnd, [{ name: "text", value: text }])
		if (phase === "listening" || phase === "processing") {
			setPhase("processing")
			deps.sendEvent(deps.events.intentStart)
			armPhaseTimer(deps.budgets.processingMaxMs, () => {
				if (phase !== "processing") return
				recoverStuckRun("processing")
			})
		}
	}

	const notifySpeechEnd = (): void => {
		if (phase !== "listening") return
		deps.sendEvent(deps.events.sttVadEnd)
		{
			setPhase("processing")
			armPhaseTimer(deps.budgets.processingMaxMs, () => {
				if (phase !== "processing") return
				recoverStuckRun("stt-final")
			})
		}
	}

	const invalidatePlayback = (reason: string): void => {
		if (playbackFallbackTimer) clearTimeout(playbackFallbackTimer)
		if (drainTimer) clearTimeout(drainTimer)
		playbackFallbackTimer = null
		drainTimer = null
		if (activePlayback) log("playback invalidated", { reason })
		activePlayback = null
		announcingObserved = false
		queue.length = 0
	}

	const finishPlayback = (how: string): void => {
		if (!activePlayback) return
		const item = activePlayback
		if (playbackFallbackTimer) clearTimeout(playbackFallbackTimer)
		if (drainTimer) clearTimeout(drainTimer)
		playbackFallbackTimer = null
		drainTimer = null
		activePlayback = null
		announcingObserved = false
		deps.onPlaybackEnd()
		log("playback finished", { how, kind: item.kind })
		if (item.followUp) {
			if (phase === "playback") {
				setPhase("expect_followup")
				armPhaseTimer(deps.budgets.followUpRequestMaxMs, () => {
					if (phase !== "expect_followup") return
					log("follow-up request never arrived — back to idle")
					nextRunIsFollowUp = false
					closeRun("followup-request-timeout")
				})
			}
		} else if (phase === "playback") {
			closeRun("playback-complete")
		}
		dispatchNext()
	}

	const dispatchNext = (): void => {
		if (disposed || activePlayback) return
		const now = Date.now()
		while (queue.length) {
			const item = queue[0]
			if (
				item.expiresAt < now ||
				(item.runGeneration !== null && item.runGeneration !== runGeneration)
			) {
				queue.shift()
				log("stale playback item evicted", { kind: item.kind })
				continue
			}
			break
		}
		if (queue[0]?.kind === "announce" && phase !== "idle") return
		const item = queue.shift()
		if (!item) return
		item.startedAt = Date.now()
		activePlayback = item
		announcingObserved = false
		deps.onPlaybackStart(item.durationMs)
		if (phase === "processing" || phase === "listening") setPhase("playback")
		if (item.kind === "reply") {
			deps.sendEvent(deps.events.intentEnd, [
				{ name: "continue_conversation", value: item.followUp ? "1" : "0" },
			])
			deps.sendEvent(deps.events.ttsStart, [{ name: "text", value: " " }])
			deps.sendEvent(deps.events.ttsEnd, [{ name: "url", value: item.url }])
			deps.sendEvent(deps.events.runEnd)
			if (item.followUp) nextRunIsFollowUp = true
		} else {
			deps.sendAnnounce(item.url, false)
		}
		const fallbackMs =
			(item.durationMs ?? PLAYBACK_ITEM_TTL_MS) +
			deps.budgets.drainMarginMs +
			PLAYBACK_FALLBACK_EXTRA_MS
		const gen = item.playbackGeneration
		playbackFallbackTimer = setTimeout(() => {
			if (disposed || activePlayback?.playbackGeneration !== gen) return
			logger.warn(
				"⚠️ playback fallback timeout — treating as ended (anomaly)",
				{
					satelliteId: deps.satelliteId,
					kind: item.kind,
				},
			)
			finishPlayback("fallback-timeout")
		}, fallbackMs)
		playbackFallbackTimer.unref?.()
	}

	const enqueuePlayback = (
		url: string,
		kind: PlaybackItemType["kind"],
		followUp: boolean,
		durationMs: number | null,
		runToken: number | null = null,
	): number | null => {
		if (disposed) return null
		if (kind === "reply" && runToken !== runGeneration) {
			log("stale reply rejected (run token missing or mismatched)", {
				runToken,
				runGeneration,
			})
			return null
		}
		if (queue.length >= PLAYBACK_QUEUE_MAX_DEPTH) {
			const idx = queue.findIndex((q) => q.kind === "announce")
			const dropped = queue.splice(idx >= 0 ? idx : 0, 1)[0]
			logger.warn("⚠️ playback queue full — dropping lowest priority", {
				satelliteId: deps.satelliteId,
				droppedKind: dropped?.kind,
			})
		}
		playbackGeneration++
		const insertAt =
			kind === "reply" ? queue.findIndex((q) => q.kind === "announce") : -1
		queue.splice(insertAt >= 0 ? insertAt : queue.length, 0, {
			url,
			kind,
			followUp,
			durationMs,
			runGeneration: kind === "reply" ? runGeneration : null,
			playbackGeneration,
			enqueuedAt: Date.now(),
			expiresAt: Date.now() + PLAYBACK_ITEM_TTL_MS,
		})
		dispatchNext()
		return playbackGeneration
	}

	const updatePlaybackDuration = (
		generation: number,
		durationMs: number | null,
	): void => {
		if (durationMs === null) return
		if (activePlayback?.playbackGeneration === generation) {
			activePlayback.durationMs = durationMs
			deps.onPlaybackDurationKnown?.(durationMs)
		}
		const queued = queue.find((q) => q.playbackGeneration === generation)
		if (queued) queued.durationMs = durationMs
	}

	const onMediaState = (state: number): void => {
		if (disposed || !activePlayback) return
		if (MEDIA_PLAYING_STATES.has(state)) {
			announcingObserved = true
			return
		}
		if (!announcingObserved) return
		const item = activePlayback
		const elapsed = Date.now() - (item.startedAt ?? item.enqueuedAt)
		const minPlaybackMs = item.durationMs
			? Math.max(0, item.durationMs - deps.budgets.drainMarginMs)
			: 0
		const waitMs = Math.max(
			deps.budgets.drainMarginMs,
			minPlaybackMs - elapsed + deps.budgets.drainMarginMs,
		)
		if (drainTimer) clearTimeout(drainTimer)
		const gen = item.playbackGeneration
		drainTimer = setTimeout(() => {
			if (disposed || activePlayback?.playbackGeneration !== gen) return
			finishPlayback("media-state")
		}, waitMs)
		drainTimer.unref?.()
	}

	const onAnnounceFinished = (): void => {
		if (disposed || !activePlayback) return
		if (announcingObserved) return
		const item = activePlayback
		const gen = item.playbackGeneration
		if (item.durationMs === null) return
		const remainingMs = Math.max(
			deps.budgets.drainMarginMs,
			item.durationMs - (Date.now() - (item.startedAt ?? item.enqueuedAt)),
		)
		if (drainTimer) clearTimeout(drainTimer)
		drainTimer = setTimeout(() => {
			if (disposed || activePlayback?.playbackGeneration !== gen) return
			finishPlayback("announce-finished+duration")
		}, remainingMs)
		drainTimer.unref?.()
	}

	const finishTurn = (): void => {
		if (disposed) return
		if (phase === "playback" || activePlayback || queue.length) return
		if (phase === "listening" || phase === "processing") {
			deps.sendEvent(deps.events.runEnd)
			closeRun("turn-finished")
		}
	}

	const dispose = (): void => {
		disposed = true
		clearPhaseTimer()
		invalidatePlayback("dispose")
	}

	return {
		onRequest,
		onTranscript,
		updatePlaybackDuration,
		notifySpeechEnd,
		enqueuePlayback,
		onMediaState,
		onAnnounceFinished,
		finishTurn,
		isFollowUpRun: () => followUpRun,
		currentGeneration: () => runGeneration,
		dispose,
	}
}

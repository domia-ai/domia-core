import type { SelectWakeWordConfigType } from "@/db"
import { audioCaptureLogger } from "@/utils"

import type { DynamicEndpointStateType, VadWindowType } from "../types"
import { createVadWindow } from "./capture"
import { clampEndpointDebounceMs } from "./endpoint-hint"

const states = new Map<string, DynamicEndpointStateType>()
const playbackStartedAt = new Map<string, number>()
const EARLY_BARGE_IN_MS = 1500
const EARLY_BARGE_IN_WIDEN_FACTOR = 1.3

export const observeIntraTurnPause = (
	domiaId: string,
	pauseMs: number,
	config: SelectWakeWordConfigType,
): void => {
	if (!config.dynamicEndpointingEnabled) return
	if (pauseMs <= 0 || pauseMs > config.dynamicEndpointMaxMs * 2) return
	const state = states.get(domiaId)
	const alpha = config.dynamicEndpointAlpha
	const pauseEmaMs =
		state === undefined
			? pauseMs
			: alpha * state.pauseEmaMs + (1 - alpha) * pauseMs
	states.set(domiaId, { pauseEmaMs })
	audioCaptureLogger.info(
		`[🎙️] intra-turn pause ${Math.round(pauseMs)}ms → EMA ${Math.round(pauseEmaMs)}ms`,
		{ domiaId },
	)
}

export const notePlaybackStarted = (domiaId: string): void => {
	if (playbackStartedAt.size > 64) {
		const oldest = playbackStartedAt.keys().next().value
		if (oldest) playbackStartedAt.delete(oldest)
	}
	playbackStartedAt.set(domiaId, Date.now())
}

export const observeBargeIn = (
	domiaId: string,
	config: SelectWakeWordConfigType,
): void => {
	if (!config.dynamicEndpointingEnabled) return
	const startedAt = playbackStartedAt.get(domiaId)
	if (startedAt === undefined) return
	if (Date.now() - startedAt > EARLY_BARGE_IN_MS) return
	const state = states.get(domiaId)
	const current =
		state?.pauseEmaMs ?? config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs
	const widened = Math.min(
		config.dynamicEndpointMaxMs,
		Math.round(current * EARLY_BARGE_IN_WIDEN_FACTOR),
	)
	states.set(domiaId, { pauseEmaMs: widened })
	audioCaptureLogger.info(
		`[🎙️] early barge-in — endpoint EMA widened to ${widened}ms`,
		{ domiaId },
	)
}

export const resolveDebounceMs = (
	domiaId: string,
	config: SelectWakeWordConfigType,
): number => {
	const baseMs = config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs
	if (!config.dynamicEndpointingEnabled) return baseMs
	const state = states.get(domiaId)
	if (!state) return baseMs
	const adaptive = Math.round(state.pauseEmaMs * config.dynamicEndpointMargin)
	return Math.max(
		config.dynamicEndpointMinMs,
		Math.min(config.dynamicEndpointMaxMs, adaptive),
	)
}

export const adaptiveVadWindow = (
	domiaId: string,
	config: SelectWakeWordConfigType,
): { vad: VadWindowType; debounceMs: number } => {
	const debounceMs = resolveDebounceMs(domiaId, config)
	const baseMs = config.vadMinSilenceS * 1000 + config.vadEndOfSpeechMs
	const semanticFloorS = config.semanticEndpointingEnabled
		? clampEndpointDebounceMs(config.endpointCompleteMs) / 1000
		: null
	const floorS = (minSilenceS: number): number =>
		semanticFloorS === null
			? minSilenceS
			: Math.min(minSilenceS, semanticFloorS)
	if (debounceMs === baseMs) {
		const minS = floorS(config.vadMinSilenceS)
		return {
			vad:
				minS === config.vadMinSilenceS
					? createVadWindow(config)
					: createVadWindow(config, { minSilenceS: minS }),
			debounceMs,
		}
	}
	const silenceShare = (config.vadMinSilenceS * 1000) / baseMs
	audioCaptureLogger.info(
		`[🎙️] adaptive endpoint debounce ${debounceMs}ms (base ${baseMs}ms)`,
		{ domiaId },
	)
	return {
		vad: createVadWindow(config, {
			minSilenceS: floorS((debounceMs * silenceShare) / 1000),
			endOfSpeechMs: Math.max(50, Math.round(debounceMs * (1 - silenceShare))),
		}),
		debounceMs,
	}
}

export const resetDynamicEndpointing = (domiaId: string): void => {
	states.delete(domiaId)
	playbackStartedAt.delete(domiaId)
}

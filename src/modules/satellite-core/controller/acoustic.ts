import {
	DEFAULT_PCM_SAMPLE_RATE,
	DEFAULT_BARGE_IN_MIN_RMS,
	DEFAULT_ACOUSTIC_GATE_COOLDOWN_MS,
	DEFAULT_ACOUSTIC_MAX_HOLD_MS,
	type SelectWakeWordConfigType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { updateSatelliteMeta } from "@/modules/core-bus"
import { getSttEngine, type SttStreamSessionType } from "@/modules/stt-engine"
import {
	createEchoGate,
	matchStopPhrase,
	type EchoGateType,
} from "@/modules/audio-capture"
import {
	predictTurnComplete,
	turnDetectorAvailable,
} from "@/modules/turn-detector"
import { int16BufferToFloat32 } from "@/utils"

import type {
	SatelliteSessionDepsType,
	SatelliteSessionStateType,
} from "../types"

export const createAcousticControls = (
	state: SatelliteSessionStateType,
	deps: SatelliteSessionDepsType,
) => {
	const { protocol } = deps

	const bargeInMinRms = (): number =>
		state.identity.wakeWordConfig?.bargeInMinRms ?? DEFAULT_BARGE_IN_MIN_RMS
	const referenceKey = (): string => `${state.identity.id}:${state.satelliteId}`
	const echoGateFor = (): EchoGateType | null => {
		const wc = state.identity.wakeWordConfig
		if (
			!wc?.echoResidualGateEnabled ||
			state.sampleRate !== DEFAULT_PCM_SAMPLE_RATE ||
			state.channels !== 1
		)
			return null
		state.echoGate ??= createEchoGate(referenceKey(), wc)
		return state.echoGate
	}
	const stopPhraseIn = (text: string): string | null => {
		const wc = state.identity.wakeWordConfig
		if (!wc?.stopWordAbortEnabled || !state.interruptingTurn) return null
		return matchStopPhrase(
			text,
			state.identity.characterProfile?.language,
			wc.stopWordMaxWords,
			wc.stopWordMaxExtraWords,
		)
	}
	const acousticGateCooldownMs = (): number =>
		state.identity.wakeWordConfig?.acousticGateCooldownMs ??
		DEFAULT_ACOUSTIC_GATE_COOLDOWN_MS
	const acousticMaxHoldMs = (): number =>
		state.identity.wakeWordConfig?.acousticMaxHoldMs ??
		DEFAULT_ACOUSTIC_MAX_HOLD_MS

	const streamingSttCreate = ():
		| ((domia: DomiaType) => SttStreamSessionType | null)
		| null => {
		if (state.sampleRate !== DEFAULT_PCM_SAMPLE_RATE || state.channels !== 1)
			return null
		if (state.identity.runtimeCapabilities?.stt !== true) return null
		const engine = state.identity.sttConfig?.engine
		const create = engine ? getSttEngine(engine)?.createSession : null
		return create ?? null
	}

	const closeSttSession = (): void => {
		abortSpeculation("session closed")
		state.sttSessionTried = false
		if (!state.sttSession) return
		const session = state.sttSession
		state.sttSession = null
		try {
			session.abort()
		} catch {
			return
		}
	}

	const speculationArmable = (
		wc: SelectWakeWordConfigType | null | undefined,
	): boolean =>
		wc?.satelliteSpeculationEnabled === true ||
		wc?.twoTierEndpointEnabled === true
	const abortSpeculation = (reason: string): void => {
		if (!state.spec) return
		const s = state.spec
		state.spec = null
		s.abort(reason)
	}
	const resetVad = (): void => {
		state.vad = null
		state.effectiveDebounceMs = state.vadDebounceMs
		state.acousticComplete = false
		state.utteranceGen += 1
		state.gateHolding = false
		state.vadCompletedAt = null
		state.semanticHintApplied = false
	}
	const acousticGateActive = (): boolean => {
		const wc = state.identity.wakeWordConfig
		return (
			!!wc?.acousticEndpointingEnabled &&
			state.sampleRate === DEFAULT_PCM_SAMPLE_RATE &&
			state.channels === 1 &&
			turnDetectorAvailable(wc.turnDetectorModelPath, wc.turnDetectorEngine)
		)
	}
	const runAcousticGate = (): void => {
		if (state.acousticChecking || state.acousticComplete) return
		if (Date.now() - state.lastAcousticRunAt < acousticGateCooldownMs()) return
		const wc = state.identity.wakeWordConfig
		if (!wc) return
		state.acousticChecking = true
		state.lastAcousticRunAt = Date.now()
		const gen = state.utteranceGen
		const pcm = int16BufferToFloat32(Buffer.concat(state.chunks))
		void predictTurnComplete(
			pcm,
			wc.turnDetectorModelPath,
			wc.acousticEndpointCompleteThreshold,
			wc.turnDetectorEngine,
		)
			.then((r) => {
				if (r && gen === state.utteranceGen) state.acousticComplete = r.complete
			})
			.finally(() => {
				state.acousticChecking = false
			})
	}

	const setMicActive = (active: boolean): void => {
		if (state.micActiveFlag === active || !state.registeredKey) return
		state.micActiveFlag = active
		updateSatelliteMeta(state.registeredKey, state.satelliteId, protocol, {
			micActive: active,
		})
	}

	return {
		bargeInMinRms,
		referenceKey,
		echoGateFor,
		stopPhraseIn,
		acousticMaxHoldMs,
		streamingSttCreate,
		closeSttSession,
		speculationArmable,
		abortSpeculation,
		resetVad,
		acousticGateActive,
		runAcousticGate,
		setMicActive,
	}
}

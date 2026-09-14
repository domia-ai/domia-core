import { DEFAULT_PCM_SAMPLE_RATE } from "@/db"
import { generateUuid } from "@/utils"

import { DEFAULT_SATELLITE_CHANNELS } from "../constants"
import type {
	SatelliteSessionDepsType,
	SatelliteSessionStateType,
} from "../types"

export const createSatelliteSessionState = (
	deps: SatelliteSessionDepsType,
): SatelliteSessionStateType => ({
	identity: deps.fallback,
	satelliteId: "unknown",
	sampleRate: DEFAULT_PCM_SAMPLE_RATE,
	channels: DEFAULT_SATELLITE_CHANNELS,
	chunks: [],
	bufferedBytes: 0,
	helloReceived: false,
	busy: false,
	interruptingTurn: false,
	echoGate: null,
	pausedBargeIn: null,
	echoWindowUntil: 0,
	ttsBytesSent: 0,
	ttsFirstSentAt: 0,
	activeInteractionId: null,
	activeFinalize: null,
	registeredKey: null,
	sttSession: null,
	sttSessionTried: false,
	connectionId: generateUuid(),
	minListenUntil: 0,
	urlPlayback: !!deps.transport.playAudioUrl,
	serverEndpointing: !!deps.transport.serverEndpointing,
	vad: null,
	vadDebounceMs: 0,
	effectiveDebounceMs: 0,
	endpointed: false,
	micActiveFlag: false,
	configRefreshTimer: null,
	acousticChecking: false,
	acousticComplete: false,
	lastAcousticRunAt: 0,
	utteranceGen: 0,
	gateHolding: false,
	vadCompletedAt: null,
	semanticHintApplied: false,
	pendingInteractionId: null,
	spec: null,
	specStarting: false,
	outputTail: Promise.resolve(),
})

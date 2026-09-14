import { safeOwnDomia, isHostedIdentity, type DomiaType } from "@/modules/core"
import {
	prefetchMemoryBundle,
	clearStreamingSink,
	registerSatelliteSink,
	unregisterSatelliteSink,
	registerSatelliteAnnouncer,
	unregisterSatelliteAnnouncer,
	updateSatelliteMeta,
	setSatellitePresence,
	clearSatellitePresence,
	setPresenceStatus,
	getIntercom,
	stopIntercom,
	stopIntercomTo,
	abortActiveTurn,
	getActiveTurn,
	getPresence,
	pauseActiveTurn,
	resumeActiveTurn,
	countBargeInResumed,
	markLadderStage,
} from "@/modules/core-bus"
import {
	adaptiveVadWindow,
	observeBargeIn,
	endpointHintMs,
	clampEndpointDebounceMs,
} from "@/modules/audio-capture"
import { generateUuid, satelliteGatewayLogger, pcm16Rms } from "@/utils"

import {
	MAX_UTTERANCE_BYTES,
	NO_VAD_MAX_UTTERANCE_S,
	PRE_SPEECH_ROLL_BYTES,
} from "../constants"
import type {
	SatelliteSessionDepsType,
	SatelliteSessionStateType,
	SatelliteSessionType,
} from "../types"
import { startSatelliteSpeculation } from "./speculation"
import { primeLlmPrefix } from "./prime-llm"
import type { createAcousticControls } from "./acoustic"
import type { createSatelliteSinks } from "./sinks"
import type { createUtteranceRunner } from "./utterance"

const CONFIG_REFRESH_MS = 3000

export const createSatelliteHandlers = (
	state: SatelliteSessionStateType,
	deps: SatelliteSessionDepsType,
	acoustic: ReturnType<typeof createAcousticControls>,
	sinks: ReturnType<typeof createSatelliteSinks>,
	utterance: ReturnType<typeof createUtteranceRunner>,
): SatelliteSessionType => {
	const { fallback, transport, protocol } = deps
	const {
		bargeInMinRms,
		echoGateFor,
		stopPhraseIn,
		acousticMaxHoldMs,
		streamingSttCreate,
		speculationArmable,
		abortSpeculation,
		closeSttSession,
		resetVad,
		acousticGateActive,
		runAcousticGate,
		setMicActive,
	} = acoustic
	const { connectionSink, announceFn } = sinks
	const { escalatePausedBargeIn, discardStopWordUtterance, handleUtterance } =
		utterance

	const resolveIdentity = async (
		domiaKey?: string,
	): Promise<DomiaType | null> => {
		if (!domiaKey) return isHostedIdentity(fallback.domiaKey) ? fallback : null
		if (!isHostedIdentity(domiaKey)) return null
		return (await safeOwnDomia(domiaKey, "satellite-core resolve")) ?? null
	}

	return {
		setMinListenUntil: (ts: number) => {
			state.minListenUntil = ts
		},
		hasPendingUtterance: () => !!state.vad?.everDetected(),
		onHello: async ({
			domiaKey,
			satelliteId: id,
			sampleRate: sr,
			channels: ch,
		}) => {
			state.satelliteId = id ?? state.satelliteId
			state.sampleRate = sr ?? state.sampleRate
			state.channels = ch ?? state.channels
			const resolved = await resolveIdentity(domiaKey)
			if (!resolved) {
				satelliteGatewayLogger.warn(
					"satellite requested unknown state.identity",
					{
						satelliteId: state.satelliteId,
						domiaKey,
					},
				)
				transport.sendError(`unknown identity: ${domiaKey}`)
				transport.close()
				return
			}
			state.identity = resolved
			state.helloReceived = true
			if (state.configRefreshTimer) clearInterval(state.configRefreshTimer)
			state.configRefreshTimer = setInterval(() => {
				if (state.busy || state.spec || state.specStarting) return
				void safeOwnDomia(
					state.identity.domiaKey,
					"satellite-core config refresh",
				).then((fresh) => {
					if (fresh && !state.busy && !state.spec && !state.specStarting)
						state.identity = fresh
				})
			}, CONFIG_REFRESH_MS)
			abortSpeculation("re-hello")
			state.chunks = []
			state.bufferedBytes = 0
			if (state.registeredKey) {
				unregisterSatelliteSink(state.registeredKey, connectionSink)
				if (announceFn)
					unregisterSatelliteAnnouncer(state.registeredKey, announceFn)
			}
			state.registeredKey = state.identity.domiaKey
			if (announceFn)
				registerSatelliteAnnouncer(
					state.registeredKey,
					announceFn,
					state.satelliteId,
				)
			else
				registerSatelliteSink(
					state.registeredKey,
					connectionSink,
					state.satelliteId,
				)
			setSatellitePresence(state.registeredKey, state.satelliteId, protocol, {
				capabilities: {
					canHear: true,
					canSpeak: true,
					canAnnounce: true,
					canIntercom: !announceFn,
					canFollowUp: !!transport.followUp,
				},
				connectionId: state.connectionId,
			})
			updateSatelliteMeta(state.registeredKey, state.satelliteId, protocol, {
				sampleRate: state.sampleRate,
			})
			satelliteGatewayLogger.info("🛰️ satellite connected", {
				satelliteId: state.satelliteId,
				domiaKey: state.identity.domiaKey,
				sampleRate: state.sampleRate,
				channels: state.channels,
			})
			if (state.serverEndpointing && !state.identity.wakeWordConfig) {
				satelliteGatewayLogger.warn(
					"satellite needs server-side endpointing but state.identity has no VAD config — using max-duration fallback",
					{ satelliteId: state.satelliteId, domiaKey: state.identity.domiaKey },
				)
			}
			transport.sendReady(state.identity.domiaKey, state.identity.name)
		},

		setFormat: (sr, ch) => {
			state.sampleRate = sr
			state.channels = ch === 2 ? 2 : 1
		},

		onAudio: (pcm) => {
			if (!state.helloReceived) return
			const intercom = getIntercom(state.identity.domiaKey)
			if (intercom) {
				abortSpeculation("intercom")
				void intercom.sink.write(pcm)
				return
			}
			if (
				!state.busy &&
				state.identity.wakeWordConfig?.echoSuppressEnabled === true &&
				Date.now() < state.echoWindowUntil &&
				pcm16Rms(pcm) < bargeInMinRms() * 2
			)
				return
			if (state.busy) {
				if (!(state.identity.wakeWordConfig?.bargeInEnabled ?? true)) return
				if (state.pausedBargeIn === null) {
					if (!getActiveTurn(state.identity.id)) return
					if (
						state.endpointed &&
						getPresence(state.identity.domiaKey)?.status !== "speaking"
					)
						return
					const gate = echoGateFor()
					if (!gate && transport.externalMediaPlaying?.()) return
					if (gate) {
						const verdict = gate.observe(pcm)
						if (!verdict.accept) return
						satelliteGatewayLogger.info(
							"🔊 residual gate — live speech over playback",
							{
								satelliteId: state.satelliteId,
								residual: verdict.residual,
								lagMs: verdict.lagMs,
								rms: Number(verdict.rms.toFixed(4)),
							},
						)
					} else if (pcm16Rms(pcm) < bargeInMinRms()) return
					state.interruptingTurn = true
					if (state.identity.wakeWordConfig)
						observeBargeIn(state.identity.id, state.identity.wakeWordConfig)
					const pauseFirst =
						state.identity.wakeWordConfig?.pauseBargeInEnabled === true
					if (
						pauseFirst &&
						pauseActiveTurn(state.identity.id, "satellite-bargein-pause")
					) {
						satelliteGatewayLogger.info(
							"⏸️ satellite barge-in — paused, awaiting confirmation",
							{
								satelliteId: state.satelliteId,
								domiaKey: state.identity.domiaKey,
							},
						)
						state.endpointed = false
						state.chunks = []
						state.bufferedBytes = 0
						resetVad()
						closeSttSession()
						setPresenceStatus(state.identity.domiaKey, "listening")
						state.pausedBargeIn = setTimeout(() => {
							state.pausedBargeIn = null
							state.chunks = []
							state.bufferedBytes = 0
							resetVad()
							closeSttSession()
							resumeActiveTurn(state.identity.id)
							countBargeInResumed(state.identity.id)
							setPresenceStatus(state.identity.domiaKey, "speaking")
							satelliteGatewayLogger.info(
								"▶️ satellite false interruption — resumed",
								{
									satelliteId: state.satelliteId,
									domiaKey: state.identity.domiaKey,
								},
							)
						}, state.identity.wakeWordConfig?.falseInterruptionTimeoutMs ?? 2000)
					} else {
						if (abortActiveTurn(state.identity.id, "satellite-bargein")) {
							satelliteGatewayLogger.info(
								"🛑 satellite barge-in — turn aborted",
								{
									satelliteId: state.satelliteId,
									domiaKey: state.identity.domiaKey,
								},
							)
						}
						state.activeFinalize?.()
						state.busy = false
						state.chunks = []
						state.bufferedBytes = 0
						resetVad()
						closeSttSession()
						setPresenceStatus(state.identity.domiaKey, "listening")
					}
				}
			}
			if (state.endpointed) return
			if (state.pausedBargeIn !== null && pcm16Rms(pcm) >= bargeInMinRms()) {
				clearTimeout(state.pausedBargeIn)
				state.pausedBargeIn = setTimeout(() => {
					state.pausedBargeIn = null
					state.chunks = []
					state.bufferedBytes = 0
					resetVad()
					closeSttSession()
					resumeActiveTurn(state.identity.id)
					setPresenceStatus(state.identity.domiaKey, "speaking")
					satelliteGatewayLogger.info(
						"▶️ satellite false interruption — resumed",
						{
							satelliteId: state.satelliteId,
							domiaKey: state.identity.domiaKey,
						},
					)
				}, state.identity.wakeWordConfig?.falseInterruptionTimeoutMs ?? 2000)
			}
			state.bufferedBytes += pcm.length
			if (state.bufferedBytes > MAX_UTTERANCE_BYTES) {
				if (state.gateHolding) {
					const speechEndAt = state.vadCompletedAt ?? Date.now()
					satelliteGatewayLogger.warn(
						"satellite utterance hit max bytes during acoustic hold — forcing endpoint",
						{
							satelliteId: state.satelliteId,
							bufferedBytes: state.bufferedBytes,
						},
					)
					resetVad()
					escalatePausedBargeIn()
					transport.notifySpeechEnd?.()
					void handleUtterance(speechEndAt)
					return
				}
				satelliteGatewayLogger.warn(
					"satellite utterance exceeded max bytes — dropping",
					{
						satelliteId: state.satelliteId,
						bufferedBytes: state.bufferedBytes,
					},
				)
				state.chunks = []
				state.bufferedBytes = 0
				state.pendingInteractionId = null
				resetVad()
				closeSttSession()
				transport.sendError("utterance too long")
				return
			}
			state.chunks.push(pcm)
			setMicActive(true)

			if (!state.pendingInteractionId && !state.busy) {
				state.pendingInteractionId = generateUuid()
				prefetchMemoryBundle(state.identity, state.pendingInteractionId)
				primeLlmPrefix(state.identity)
			}

			const speechSeen =
				!state.serverEndpointing || state.vad?.everDetected() === true
			if (!state.sttSession && !state.sttSessionTried && speechSeen) {
				state.sttSessionTried = true
				const create = streamingSttCreate()
				if (create) {
					try {
						state.sttSession = create(state.identity)
					} catch {
						state.sttSession = null
					}
					if (state.sttSession) {
						for (const buffered of state.chunks)
							state.sttSession.pushChunk(buffered)
					} else {
						satelliteGatewayLogger.info(
							"🛰️ streaming STT slot unavailable — batch fallback",
							{
								satelliteId: state.satelliteId,
								domiaKey: state.identity.domiaKey,
							},
						)
					}
				}
			} else {
				state.sttSession?.pushChunk(pcm)
			}
			if (state.sttSession) {
				const phrase = stopPhraseIn(state.sttSession.partial())
				if (phrase !== null) {
					discardStopWordUtterance(phrase, "interim")
					return
				}
			}

			if (!state.serverEndpointing) return
			if (!state.vad && state.identity.wakeWordConfig) {
				const win = adaptiveVadWindow(
					state.identity.id,
					state.identity.wakeWordConfig,
				)
				state.vad = win.vad
				state.vadDebounceMs = win.debounceMs
				state.effectiveDebounceMs = win.debounceMs
			}
			if (!state.vad) {
				const seconds =
					state.bufferedBytes / (state.sampleRate * state.channels * 2)
				if (seconds >= NO_VAD_MAX_UTTERANCE_S) {
					transport.notifySpeechEnd?.()
					void handleUtterance(Date.now())
				}
				return
			}
			state.vad.feed(pcm)
			const wc = state.identity.wakeWordConfig
			const semantic =
				!!wc?.semanticEndpointingEnabled && state.sttSession !== null
			if (semantic) {
				const hint = endpointHintMs(
					state.sttSession?.partial() ?? "",
					wc.endpointCompleteMs,
					wc.endpointIncompleteMs,
					wc.endpointWaitMs,
				)
				state.effectiveDebounceMs =
					hint === null ? state.vadDebounceMs : clampEndpointDebounceMs(hint)
				state.semanticHintApplied = hint !== null
			}
			if (state.vad.speechActive()) {
				state.acousticComplete = false
				state.gateHolding = false
				state.vadCompletedAt = null
			}
			if (
				!state.vad.everDetected() &&
				state.bufferedBytes > PRE_SPEECH_ROLL_BYTES
			) {
				while (
					state.chunks.length > 1 &&
					state.bufferedBytes - (state.chunks[0]?.length ?? 0) >=
						PRE_SPEECH_ROLL_BYTES
				) {
					state.bufferedBytes -= state.chunks[0]?.length ?? 0
					state.chunks.shift()
				}
			}
			const silenceDone = semantic
				? state.vad.everDetected() &&
					!state.vad.speechActive() &&
					state.vad.holdMs() + state.vad.silenceMs() >=
						state.effectiveDebounceMs
				: state.vad.completed()
			if (
				silenceDone &&
				Date.now() < state.minListenUntil &&
				!(state.sttSession?.partial() ?? "").trim()
			)
				return
			if (silenceDone) {
				if (state.vadCompletedAt === null)
					satelliteGatewayLogger.info("⏱️ endpoint decision", {
						semantic,
						effectiveDebounceMs: state.effectiveDebounceMs,
						vadDebounceMs: state.vadDebounceMs,
						partialTail: (state.sttSession?.partial() ?? "").slice(-30),
					})
				state.vadCompletedAt ??=
					Date.now() -
					(semantic
						? state.vad.holdMs() + state.vad.silenceMs()
						: state.vadDebounceMs)
				if (
					!state.semanticHintApplied &&
					acousticGateActive() &&
					!state.acousticComplete &&
					Date.now() - state.vadCompletedAt < acousticMaxHoldMs()
				) {
					state.gateHolding = true
					runAcousticGate()
					return
				}
				const speechEndAt = state.vadCompletedAt
				resetVad()
				escalatePausedBargeIn()
				transport.notifySpeechEnd?.()
				void handleUtterance(speechEndAt)
				return
			}
			if (
				speculationArmable(wc) &&
				!state.busy &&
				!state.spec &&
				!state.specStarting &&
				(state.pausedBargeIn !== null ||
					state.pendingInteractionId === null ||
					state.sttSession === null ||
					!state.vad.everDetected())
			)
				satelliteGatewayLogger.debug("🔮 speculation precondition miss", {
					pausedBargeIn: state.pausedBargeIn !== null,
					pendingInteraction: state.pendingInteractionId !== null,
					sttSession: state.sttSession !== null,
					vadDetected: state.vad.everDetected(),
				})
			if (
				!state.busy &&
				!state.spec &&
				!state.specStarting &&
				state.pausedBargeIn === null &&
				state.pendingInteractionId !== null &&
				state.sttSession !== null &&
				state.vad.everDetected() &&
				speculationArmable(wc)
			) {
				state.specStarting = true
				const gen = state.utteranceGen
				const iid = state.pendingInteractionId
				startSatelliteSpeculation({
					identity: state.identity,
					interactionId: iid,
					sttSession: () => state.sttSession,
					vadDebounceMs: state.vadDebounceMs,
					bufferedPcm: () => Buffer.concat(state.chunks),
					bargeIn: state.interruptingTurn,
				})
					.then((started) => {
						state.specStarting = false
						if (!started) return
						if (
							gen !== state.utteranceGen ||
							state.busy ||
							state.pendingInteractionId !== iid
						) {
							started.abort("stale")
							return
						}
						state.spec = started
						started.done.catch(() => {
							if (state.spec === started) {
								state.spec = null
								started.release()
							}
						})
					})
					.catch((err: unknown) => {
						state.specStarting = false
						satelliteGatewayLogger.warn("satellite speculation start failed", {
							err,
						})
					})
			}
			state.spec?.feed(pcm, () => Buffer.concat(state.chunks))
		},

		onSpeechEnd: async () => {
			if (!state.helloReceived) {
				satelliteGatewayLogger.debug("speech_end before hello — ignored", {
					satelliteId: state.satelliteId,
				})
				return
			}
			escalatePausedBargeIn()
			await handleUtterance(Date.now())
		},

		onAudioPlayed: (interactionId) => {
			if (!state.activeInteractionId) return
			if (interactionId !== state.activeInteractionId) return
			markLadderStage(state.activeInteractionId, "audioAudibleAt")
		},

		onCancel: () => {
			if (!state.helloReceived) {
				satelliteGatewayLogger.debug("cancel before hello — ignored", {
					satelliteId: state.satelliteId,
				})
				return
			}
			if (state.pausedBargeIn !== null) {
				clearTimeout(state.pausedBargeIn)
				state.pausedBargeIn = null
			}
			state.chunks = []
			state.bufferedBytes = 0
			state.pendingInteractionId = null
			resetVad()
			closeSttSession()
			state.endpointed = false
			setMicActive(false)
			state.minListenUntil = 0
			if (state.activeInteractionId)
				abortActiveTurn(state.identity.id, "satellite-cancel")
			state.activeFinalize?.()
		},

		onClose: () => {
			if (state.configRefreshTimer) {
				clearInterval(state.configRefreshTimer)
				state.configRefreshTimer = null
			}
			state.pendingInteractionId = null
			if (state.pausedBargeIn !== null) {
				clearTimeout(state.pausedBargeIn)
				state.pausedBargeIn = null
			}
			state.chunks = []
			state.bufferedBytes = 0
			resetVad()
			closeSttSession()
			state.endpointed = false
			state.busy = false
			setMicActive(false)
			if (state.activeInteractionId) {
				abortActiveTurn(state.identity.id, "satellite-disconnect")
				clearStreamingSink(state.activeInteractionId)
			}
			state.activeFinalize?.()
			if (state.registeredKey) {
				void stopIntercom(state.registeredKey)
				void stopIntercomTo(state.registeredKey)
				unregisterSatelliteSink(state.registeredKey, connectionSink)
				if (announceFn)
					unregisterSatelliteAnnouncer(state.registeredKey, announceFn)
				clearSatellitePresence(
					state.registeredKey,
					state.satelliteId,
					state.connectionId,
				)
			}
			satelliteGatewayLogger.info("🛰️ satellite disconnected", {
				satelliteId: state.satelliteId,
			})
		},
	}
}

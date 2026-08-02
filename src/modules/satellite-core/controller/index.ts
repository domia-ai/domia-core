import { writeFile, readFile } from "fs/promises"
import { join } from "path"

import { type DomiaType, safeOwnDomia, isHostedIdentity } from "@/modules/core"
import {
	INTERACTION_STATUS_ENUM,
	DEFAULT_SATELLITE_TURN_TIMEOUT_MS,
} from "@/db"
import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { RESPONSE_TYPE_ENUM } from "@/db"
import {
	beginInteraction,
	prefetchMemoryBundle,
	clearInteraction,
	persistTerminal,
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
	pauseActiveTurn,
	resumeActiveTurn,
	countBargeInResumed,
	countBargeInEscalated,
	buildAudioUrl,
	registerAudioForServing,
	getAudioFilePath,
	openAudioStream,
	writeAudioStream,
	closeAudioStream,
	markLadderStage,
	type StreamingSinkType,
	type TurnScopeType,
} from "@/modules/core-bus"
import { getSttEngine, type SttStreamSessionType } from "@/modules/stt-engine"
import { acknowledgeEndpoint } from "@/modules/feedback-sounds"
import { runLLM } from "@/modules/llm-engine"
import {
	personaContextFromDomia,
	buildPromptFromPersona,
} from "@/modules/prompt-context-builder"
import {
	RECORDINGS_DIR,
	adaptiveVadWindow,
	observeBargeIn,
	int16BufferToFloat32,
	endpointHintMs,
	clampEndpointDebounceMs,
	type VadWindowType,
} from "@/modules/audio-capture"
import {
	predictTurnComplete,
	turnDetectorAvailable,
} from "@/modules/turn-detector"
import {
	wrapPcmToWav,
	wavFileToPcmChunks,
	generateUuid,
	satelliteGatewayLogger,
} from "@/utils"

import {
	DEFAULT_SATELLITE_SAMPLE_RATE,
	DEFAULT_SATELLITE_CHANNELS,
	MAX_UTTERANCE_BYTES,
	NO_VAD_MAX_UTTERANCE_S,
	PRE_SPEECH_ROLL_BYTES,
} from "../constants"
import { startSatelliteSpeculation } from "./speculation"
import type {
	SatelliteSessionDepsType,
	SatelliteSessionType,
	SatelliteSpeculationType,
} from "../types"

const BARGE_IN_MIN_RMS = 0.008

const frameRms = (pcm: Buffer): number => {
	if (pcm.length < 2) return 0
	let sum = 0
	const samples = pcm.length >> 1
	for (let i = 0; i < samples; i++) {
		const v = pcm.readInt16LE(i << 1) / 32768
		sum += v * v
	}
	return Math.sqrt(sum / samples)
}

// prime the static persona prefix into the LLM cache at speech start, so the real request hits a warm prefill
const LLM_PRIME_MIN_INTERVAL_MS = 60_000
const lastLlmPrimeAt = new Map<string, number>()
const primeLlmPrefix = (domia: DomiaType): void => {
	const now = Date.now()
	if (now - (lastLlmPrimeAt.get(domia.id) ?? 0) < LLM_PRIME_MIN_INTERVAL_MS)
		return
	lastLlmPrimeAt.set(domia.id, now)
	const cfg = domia.llmModelConfig
	if (!cfg) return
	const prompt = buildPromptFromPersona(personaContextFromDomia(domia), "", {
		omitUserInput: true,
	})
	void runLLM({ ...domia, llmModelConfig: { ...cfg, numPredict: 1 } }, prompt)
		.then(() => satelliteGatewayLogger.info("🔥 llm prefix primed"))
		.catch(() => undefined)
}

const sendViaSink = async (
	sink: StreamingSinkType,
	filePath: string,
): Promise<void> => {
	const header = await readFile(filePath)
	if (header.length < 44 || header.toString("ascii", 0, 4) !== "RIFF") return
	const rawChannels = header.readUInt16LE(22)
	const sampleRate = header.readUInt32LE(24)
	const channels = rawChannels === 2 ? 2 : 1
	await sink.begin?.({ sampleRate, channels })
	try {
		for await (const chunk of wavFileToPcmChunks(filePath)) {
			await sink.write(chunk)
		}
	} finally {
		await sink.end?.()
	}
}

export const createSatelliteSession = (
	deps: SatelliteSessionDepsType,
): SatelliteSessionType => {
	const { fallback, transport, protocol } = deps

	let identity: DomiaType = fallback
	let satelliteId = "unknown"
	let sampleRate = DEFAULT_SATELLITE_SAMPLE_RATE
	let channels = DEFAULT_SATELLITE_CHANNELS
	let chunks: Buffer[] = []
	let bufferedBytes = 0
	let helloReceived = false
	let busy = false
	let pausedBargeIn: ReturnType<typeof setTimeout> | null = null
	let echoWindowUntil = 0
	let ttsBytesSent = 0
	let ttsFirstSentAt = 0
	let activeInteractionId: string | null = null
	let activeFinalize: (() => void) | null = null
	let registeredKey: string | null = null
	let sttSession: SttStreamSessionType | null = null
	let sttSessionTried = false
	const connectionId = generateUuid()

	const STT_SAMPLE_RATE = 16000
	const CONFIG_REFRESH_MS = 3000
	const ACOUSTIC_GATE_COOLDOWN_MS = 250
	const ACOUSTIC_MAX_HOLD_MS = 2000
	let minListenUntil = 0

	const streamingSttCreate = ():
		| ((domia: DomiaType) => SttStreamSessionType | null)
		| null => {
		if (sampleRate !== STT_SAMPLE_RATE || channels !== 1) return null
		if (identity.runtimeCapabilities?.stt !== true) return null
		const engine = identity.sttConfig?.engine
		const create = engine ? getSttEngine(engine)?.createSession : null
		return create ?? null
	}

	const closeSttSession = (): void => {
		abortSpeculation("session closed")
		sttSessionTried = false
		if (!sttSession) return
		const session = sttSession
		sttSession = null
		try {
			session.abort()
		} catch {
			return
		}
	}

	const urlPlayback = !!transport.playAudioUrl
	const serverEndpointing = !!transport.serverEndpointing
	let vad: VadWindowType | null = null
	let vadDebounceMs = 0
	let effectiveDebounceMs = 0
	let endpointed = false
	let micActiveFlag = false
	let configRefreshTimer: ReturnType<typeof setInterval> | null = null
	let acousticChecking = false
	let acousticComplete = false
	let lastAcousticRunAt = 0
	let utteranceGen = 0
	let gateHolding = false
	let vadCompletedAt: number | null = null
	// a semantic hint outranks the acoustic gate — stacking smart-turn after it only adds latency
	let semanticHintApplied = false
	let pendingInteractionId: string | null = null
	let spec: SatelliteSpeculationType | null = null
	let specStarting = false
	const abortSpeculation = (reason: string): void => {
		if (!spec) return
		const s = spec
		spec = null
		s.abort(reason)
	}
	const resetVad = (): void => {
		vad = null
		effectiveDebounceMs = vadDebounceMs
		acousticComplete = false
		utteranceGen += 1
		gateHolding = false
		vadCompletedAt = null
		semanticHintApplied = false
	}
	const acousticGateActive = (): boolean => {
		const wc = identity.wakeWordConfig
		return (
			!!wc?.acousticEndpointingEnabled &&
			sampleRate === STT_SAMPLE_RATE &&
			channels === 1 &&
			turnDetectorAvailable(wc.turnDetectorModelPath, wc.turnDetectorEngine)
		)
	}
	const runAcousticGate = (): void => {
		if (acousticChecking || acousticComplete) return
		if (Date.now() - lastAcousticRunAt < ACOUSTIC_GATE_COOLDOWN_MS) return
		const wc = identity.wakeWordConfig
		if (!wc) return
		acousticChecking = true
		lastAcousticRunAt = Date.now()
		const gen = utteranceGen
		const pcm = int16BufferToFloat32(Buffer.concat(chunks))
		void predictTurnComplete(
			pcm,
			wc.turnDetectorModelPath,
			wc.acousticEndpointCompleteThreshold,
			wc.turnDetectorEngine,
		)
			.then((r) => {
				if (r && gen === utteranceGen) acousticComplete = r.complete
			})
			.finally(() => {
				acousticChecking = false
			})
	}
	const setMicActive = (active: boolean): void => {
		if (micActiveFlag === active || !registeredKey) return
		micActiveFlag = active
		updateSatelliteMeta(registeredKey, satelliteId, protocol, {
			micActive: active,
		})
	}

	let outputTail: Promise<void> = Promise.resolve()
	const acquireOutput = (): Promise<() => void> => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const prev = outputTail
		outputTail = outputTail.then(() => gate)
		return prev.then(() => release)
	}

	const makeSink = (onWrite?: () => void): StreamingSinkType => {
		let release: (() => void) | null = null
		let sinkRate = 24000
		let sinkChannels = 1
		return {
			capabilities: transport.outputCapabilities,
			pause: transport.pauseAudio,
			resume: transport.resumeAudio,
			begin: async (format) => {
				sinkRate = format.sampleRate
				sinkChannels = format.channels
				release = await acquireOutput()
				try {
					setPresenceStatus(identity.domiaKey, "speaking")
					transport.beginAudio(format, activeInteractionId ?? undefined)
				} catch (err) {
					release?.()
					release = null
					throw err
				}
			},
			write: (chunk) => {
				onWrite?.()
				if (ttsFirstSentAt === 0) ttsFirstSentAt = Date.now()
				ttsBytesSent += chunk.length
				echoWindowUntil =
					ttsFirstSentAt +
					ttsBytesSent / ((sinkRate * sinkChannels * 2) / 1000) +
					(identity?.wakeWordConfig?.echoSuppressMarginMs ?? 500)
				return transport.writeAudio(chunk)
			},
			end: () => {
				try {
					transport.endAudio()
				} finally {
					release?.()
					release = null
				}
			},
		}
	}

	const makeCaptureSink = (
		interactionId: string,
		onFirstChunk: () => void,
	): StreamingSinkType => {
		let release: (() => void) | null = null
		let announced = false
		return {
			capabilities: transport.outputCapabilities,
			pause: transport.pauseAudio,
			resume: transport.resumeAudio,
			begin: async (format) => {
				release = await acquireOutput()
				setPresenceStatus(identity.domiaKey, "speaking")
				openAudioStream(interactionId, format.sampleRate, format.channels)
			},
			write: async (chunk) => {
				await writeAudioStream(interactionId, chunk)
				if (!announced) {
					announced = true
					onFirstChunk()
				}
			},
			end: () => {
				closeAudioStream(interactionId)
				release?.()
				release = null
			},
		}
	}

	const connectionSink = makeSink()
	const announceFn = transport.announce
		? (url: string) => transport.announce?.(url)
		: null

	const resolveIdentity = async (
		domiaKey?: string,
	): Promise<DomiaType | null> => {
		if (!domiaKey) return isHostedIdentity(fallback.domiaKey) ? fallback : null
		if (!isHostedIdentity(domiaKey)) return null
		return (await safeOwnDomia(domiaKey, "satellite-core resolve")) ?? null
	}

	const persistTurnFailure = (
		interactionId: string,
		err: unknown,
	): Promise<void> => {
		const message = err instanceof Error ? err.message : String(err)
		return persistTerminal(interactionId, INTERACTION_STATUS_ENUM.FAILED, {
			errorStep: message.includes("timeout") ? "timeout" : "satellite",
			errorMessage: message,
		})
	}

	const escalatePausedBargeIn = (): void => {
		if (pausedBargeIn === null) return
		clearTimeout(pausedBargeIn)
		pausedBargeIn = null
		countBargeInEscalated(identity.id)
		abortActiveTurn(identity.id, "satellite-bargein")
		activeFinalize?.()
		busy = false
	}

	const handleUtterance = async (speechEndAt?: number): Promise<void> => {
		if (busy) return
		const endpointDecisionAt = Date.now()
		const owned = spec
		spec = null
		const session = sttSession
		sttSession = null
		sttSessionTried = false
		const pcm = Buffer.concat(chunks)
		chunks = []
		bufferedBytes = 0
		if (pcm.length === 0) {
			owned?.abort("empty utterance")
			session?.abort()
			return
		}
		busy = true
		if (serverEndpointing) endpointed = true
		setMicActive(false)
		if (registeredKey) {
			updateSatelliteMeta(registeredKey, satelliteId, protocol, {
				lastTurnAt: Date.now(),
			})
		}
		const wav = wrapPcmToWav(pcm, sampleRate, channels, 16)
		const path = join(RECORDINGS_DIR, `satellite-${generateUuid()}.wav`)
		const interactionId = pendingInteractionId ?? generateUuid()
		pendingInteractionId = null
		minListenUntil = 0
		transport.onTurnStarted?.(interactionId)
		acknowledgeEndpoint(identity, interactionId, {
			playSound: false,
			sinceSpeechEndMs: speechEndAt
				? endpointDecisionAt - speechEndAt
				: undefined,
		})
		if (owned && owned.interactionId !== interactionId)
			owned.abort("interaction mismatch")
		const ownedTurn =
			owned && owned.interactionId === interactionId ? owned : null
		activeInteractionId = interactionId
		let turn: TurnScopeType | null = null
		const turnStart = Date.now()
		let framesSent = 0
		let streamAnnounced = false
		const turnSink = urlPlayback
			? makeCaptureSink(interactionId, () => {
					const url = buildAudioUrl(identity, interactionId)
					if (url) {
						transport.playAudioUrl?.(url, interactionId)
						streamAnnounced = true
					}
				})
			: makeSink(() => {
					framesSent++
				})
		ttsBytesSent = 0
		ttsFirstSentAt = 0

		let finalized = false
		const finalize = (): void => {
			if (finalized) return
			finalized = true
			if (activeFinalize === finalize) activeFinalize = null
			clearTimeout(turnTimeout)
			closeAudioStream(interactionId)
			turn?.end()
			clearInteraction(interactionId)
			if (activeInteractionId === interactionId) {
				activeInteractionId = null
				setPresenceStatus(identity.domiaKey, "idle", true)
				busy = false
				endpointed = false
			}
			transport.onTurnFinished?.(interactionId)
			transport.finishTurn?.()
		}
		activeFinalize = finalize
		const turnTimeout = setTimeout(() => {
			abortActiveTurn(identity.id, "satellite-timeout")
			void persistTurnFailure(
				interactionId,
				new Error("satellite turn timeout"),
			)
			transport.sendError("satellite turn timeout")
			finalize()
		}, DEFAULT_SATELLITE_TURN_TIMEOUT_MS)

		const inputAudioMs = Math.round(
			(pcm.length / (sampleRate * channels * 2)) * 1000,
		)

		const handle = await beginInteraction(
			identity,
			{
				input: { kind: "audio_file", filePath: path, inputAudioMs },
				requestedOutput: { kind: "voice" },
				source: "satellite",
				interactionId,
				satelliteId,
				satelliteProtocol: protocol,
			},
			{
				audioDelivery: urlPlayback ? "audio-url" : "streaming-sink",
				createdAt: turnStart,
				liveTurn: true,
				wantsTranscript: true,
				sink: turnSink,
				onTranscript: (transcript) =>
					transport.sendTranscript(transcript, interactionId),
				onComplete: (result) => {
					void (async () => {
						try {
							let served = false
							if (urlPlayback) {
								if (result.ttsFilePath) {
									registerAudioForServing(interactionId, result.ttsFilePath)
								}
								if (streamAnnounced) {
									served = true
								} else {
									const audioUrl = getAudioFilePath(interactionId)
										? buildAudioUrl(identity, interactionId)
										: null
									if (audioUrl) {
										transport.playAudioUrl?.(audioUrl, interactionId)
										served = true
									}
								}
							} else if (framesSent === 0 && result.ttsFilePath) {
								await sendViaSink(turnSink, result.ttsFilePath)
								served = true
							} else if (framesSent > 0) {
								served = true
							}
							transport.sendReplyDone(result.reply, interactionId)
							satelliteGatewayLogger.info("🛰️ satellite turn", {
								satelliteId,
								protocol,
								domiaKey: identity.domiaKey,
								interactionId,
								transcriptChars: result.transcript.trim().length,
								replyChars: result.reply.trim().length,
								served,
								turnMs: Date.now() - turnStart,
							})
						} catch (err) {
							satelliteGatewayLogger.error("satellite onComplete failed", {
								err,
								satelliteId,
								interactionId,
							})
						} finally {
							finalize()
						}
					})()
				},
				onError: (error) => {
					void (async () => {
						try {
							satelliteGatewayLogger.error("satellite turn failed", {
								error,
								satelliteId,
								protocol,
								domiaKey: identity.domiaKey,
								interactionId,
								turnMs: Date.now() - turnStart,
							})
							await persistTurnFailure(interactionId, error)
							transport.sendError(error)
						} catch (err) {
							satelliteGatewayLogger.warn("satellite onError handler failed", {
								err,
								interactionId,
							})
						} finally {
							finalize()
						}
					})()
				},
			},
		)
		if (!handle) {
			owned?.abort("begin-interaction failed")
			transport.sendError("satellite: failed to create interaction")
			finalize()
			return
		}
		turn = handle.turn

		try {
			if (ownedTurn) {
				const archived = writeFile(path, wav).then(() => path)
				ownedTurn.handoff({
					pcm,
					speechEndAt,
					endpointDecisionAt,
					filePathPromise: archived,
				})
				void ownedTurn.done.catch((err) => {
					satelliteGatewayLogger.warn(
						"speculative turn failed post-handoff — batch fallback",
						{ err, interactionId },
					)
					ownedTurn.release()
					publishToDomiaBus(identity.id, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
						filePath: path,
						interactionId,
						originDomiaKey: identity.domiaKey,
						speechEndAt,
						endpointDecisionAt,
						endpointDebounceMs: vadDebounceMs || undefined,
					})
				})
			} else if (session) {
				const flushStart = Date.now()
				const usePartial = identity.sttConfig?.partialAtEndpointEnabled === true
				let transcript = usePartial ? session.partial().trim() : ""
				if (usePartial && transcript) {
					session.abort()
				} else {
					transcript = await session.finish()
				}
				satelliteGatewayLogger.info("⏱️ stt flush breakdown", {
					flushMs: Date.now() - flushStart,
					sinceSpeechEndMs: speechEndAt ? flushStart - speechEndAt : null,
					partialAtEndpoint: usePartial && !!transcript,
					interactionId,
				})
				void writeFile(path, wav).catch((err) =>
					satelliteGatewayLogger.warn("satellite audio archive write failed", {
						path,
						err,
					}),
				)
				publishToDomiaBus(identity.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
					transcript,
					interactionId,
					originDomiaKey: identity.domiaKey,
					responseType: RESPONSE_TYPE_ENUM.VOICE,
					speechEndAt,
					endpointDecisionAt,
					endpointDebounceMs: vadDebounceMs || undefined,
				})
			} else {
				await writeFile(path, wav)
				publishToDomiaBus(identity.id, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
					filePath: path,
					interactionId,
					originDomiaKey: identity.domiaKey,
					speechEndAt,
					endpointDecisionAt,
					endpointDebounceMs: vadDebounceMs || undefined,
				})
			}
		} catch (err) {
			if (ownedTurn) ownedTurn.abort("utterance handling failed")
			else session?.abort()
			await persistTurnFailure(interactionId, err)
			transport.sendError(String(err))
			finalize()
		}
	}

	return {
		setMinListenUntil: (ts: number) => {
			minListenUntil = ts
		},
		hasPendingUtterance: () => !!vad?.everDetected(),
		onHello: async ({
			domiaKey,
			satelliteId: id,
			sampleRate: sr,
			channels: ch,
		}) => {
			satelliteId = id ?? satelliteId
			sampleRate = sr ?? sampleRate
			channels = ch ?? channels
			const resolved = await resolveIdentity(domiaKey)
			if (!resolved) {
				satelliteGatewayLogger.warn("satellite requested unknown identity", {
					satelliteId,
					domiaKey,
				})
				transport.sendError(`unknown identity: ${domiaKey}`)
				transport.close()
				return
			}
			identity = resolved
			helloReceived = true
			if (configRefreshTimer) clearInterval(configRefreshTimer)
			configRefreshTimer = setInterval(() => {
				if (busy || spec || specStarting) return
				void safeOwnDomia(
					identity.domiaKey,
					"satellite-core config refresh",
				).then((fresh) => {
					if (fresh && !busy && !spec && !specStarting) identity = fresh
				})
			}, CONFIG_REFRESH_MS)
			abortSpeculation("re-hello")
			chunks = []
			bufferedBytes = 0
			if (registeredKey) {
				unregisterSatelliteSink(registeredKey, connectionSink)
				if (announceFn) unregisterSatelliteAnnouncer(registeredKey, announceFn)
			}
			registeredKey = identity.domiaKey
			if (announceFn) registerSatelliteAnnouncer(registeredKey, announceFn)
			else registerSatelliteSink(registeredKey, connectionSink)
			setSatellitePresence(registeredKey, satelliteId, protocol, {
				capabilities: {
					canHear: true,
					canSpeak: true,
					canAnnounce: true,
					canIntercom: !announceFn,
					canFollowUp: !!transport.followUp,
				},
				connectionId,
			})
			updateSatelliteMeta(registeredKey, satelliteId, protocol, { sampleRate })
			satelliteGatewayLogger.info("🛰️ satellite connected", {
				satelliteId,
				domiaKey: identity.domiaKey,
				sampleRate,
				channels,
			})
			if (serverEndpointing && !identity.wakeWordConfig) {
				satelliteGatewayLogger.warn(
					"satellite needs server-side endpointing but identity has no VAD config — using max-duration fallback",
					{ satelliteId, domiaKey: identity.domiaKey },
				)
			}
			transport.sendReady(identity.domiaKey, identity.name)
		},

		setFormat: (sr, ch) => {
			sampleRate = sr
			channels = ch === 2 ? 2 : 1
		},

		onAudio: (pcm) => {
			if (!helloReceived) return
			const intercom = getIntercom(identity.domiaKey)
			if (intercom) {
				abortSpeculation("intercom")
				void intercom.sink.write(pcm)
				return
			}
			if (
				!busy &&
				identity.wakeWordConfig?.echoSuppressEnabled === true &&
				Date.now() < echoWindowUntil &&
				frameRms(pcm) < BARGE_IN_MIN_RMS * 2
			)
				return
			if (busy) {
				if (!(identity.wakeWordConfig?.bargeInEnabled ?? true)) return
				if (pausedBargeIn === null && frameRms(pcm) < BARGE_IN_MIN_RMS) return
				if (pausedBargeIn === null) {
					if (identity.wakeWordConfig)
						observeBargeIn(identity.id, identity.wakeWordConfig)
					const pauseFirst =
						identity.wakeWordConfig?.pauseBargeInEnabled === true
					if (
						pauseFirst &&
						pauseActiveTurn(identity.id, "satellite-bargein-pause")
					) {
						satelliteGatewayLogger.info(
							"⏸️ satellite barge-in — paused, awaiting confirmation",
							{ satelliteId, domiaKey: identity.domiaKey },
						)
						endpointed = false
						chunks = []
						bufferedBytes = 0
						resetVad()
						closeSttSession()
						setPresenceStatus(identity.domiaKey, "listening")
						pausedBargeIn = setTimeout(() => {
							pausedBargeIn = null
							chunks = []
							bufferedBytes = 0
							resetVad()
							closeSttSession()
							resumeActiveTurn(identity.id)
							countBargeInResumed(identity.id)
							setPresenceStatus(identity.domiaKey, "speaking")
							satelliteGatewayLogger.info(
								"▶️ satellite false interruption — resumed",
								{ satelliteId, domiaKey: identity.domiaKey },
							)
						}, identity.wakeWordConfig?.falseInterruptionTimeoutMs ?? 2000)
					} else {
						if (abortActiveTurn(identity.id, "satellite-bargein")) {
							satelliteGatewayLogger.info(
								"🛑 satellite barge-in — turn aborted",
								{ satelliteId, domiaKey: identity.domiaKey },
							)
						}
						activeFinalize?.()
						busy = false
						chunks = []
						bufferedBytes = 0
						resetVad()
						closeSttSession()
						setPresenceStatus(identity.domiaKey, "listening")
					}
				}
			}
			if (endpointed) return
			if (pausedBargeIn !== null && frameRms(pcm) >= BARGE_IN_MIN_RMS) {
				clearTimeout(pausedBargeIn)
				pausedBargeIn = setTimeout(() => {
					pausedBargeIn = null
					chunks = []
					bufferedBytes = 0
					resetVad()
					closeSttSession()
					resumeActiveTurn(identity.id)
					setPresenceStatus(identity.domiaKey, "speaking")
					satelliteGatewayLogger.info(
						"▶️ satellite false interruption — resumed",
						{ satelliteId, domiaKey: identity.domiaKey },
					)
				}, identity.wakeWordConfig?.falseInterruptionTimeoutMs ?? 2000)
			}
			bufferedBytes += pcm.length
			if (bufferedBytes > MAX_UTTERANCE_BYTES) {
				if (gateHolding) {
					const speechEndAt = vadCompletedAt ?? Date.now()
					satelliteGatewayLogger.warn(
						"satellite utterance hit max bytes during acoustic hold — forcing endpoint",
						{ satelliteId, bufferedBytes },
					)
					resetVad()
					escalatePausedBargeIn()
					transport.notifySpeechEnd?.()
					void handleUtterance(speechEndAt)
					return
				}
				satelliteGatewayLogger.warn(
					"satellite utterance exceeded max bytes — dropping",
					{ satelliteId, bufferedBytes },
				)
				chunks = []
				bufferedBytes = 0
				pendingInteractionId = null
				resetVad()
				closeSttSession()
				transport.sendError("utterance too long")
				return
			}
			chunks.push(pcm)
			setMicActive(true)

			if (!pendingInteractionId && !busy) {
				pendingInteractionId = generateUuid()
				prefetchMemoryBundle(identity, pendingInteractionId)
				primeLlmPrefix(identity)
			}

			// gate on detected speech so ambient noise never pins a streaming pool worker
			const speechSeen =
				!serverEndpointing || (vad !== null && vad.everDetected())
			if (!sttSession && !sttSessionTried && speechSeen) {
				sttSessionTried = true
				const create = streamingSttCreate()
				if (create) {
					try {
						sttSession = create(identity)
					} catch {
						sttSession = null
					}
					if (sttSession) {
						for (const buffered of chunks) sttSession.pushChunk(buffered)
					} else {
						satelliteGatewayLogger.info(
							"🛰️ streaming STT slot unavailable — batch fallback",
							{ satelliteId, domiaKey: identity.domiaKey },
						)
					}
				}
			} else {
				sttSession?.pushChunk(pcm)
			}

			if (!serverEndpointing) return
			if (!vad && identity.wakeWordConfig) {
				const win = adaptiveVadWindow(identity.id, identity.wakeWordConfig)
				vad = win.vad
				vadDebounceMs = win.debounceMs
				effectiveDebounceMs = win.debounceMs
			}
			if (!vad) {
				const seconds = bufferedBytes / (sampleRate * channels * 2)
				if (seconds >= NO_VAD_MAX_UTTERANCE_S) {
					transport.notifySpeechEnd?.()
					void handleUtterance(Date.now())
				}
				return
			}
			vad.feed(pcm)
			const wc = identity.wakeWordConfig
			const semantic = !!wc?.semanticEndpointingEnabled && sttSession !== null
			if (semantic && wc) {
				const hint = endpointHintMs(
					sttSession?.partial() ?? "",
					wc.endpointCompleteMs,
					wc.endpointIncompleteMs,
					wc.endpointWaitMs,
				)
				effectiveDebounceMs =
					hint === null ? vadDebounceMs : clampEndpointDebounceMs(hint)
				semanticHintApplied = hint !== null
			}
			if (vad.speechActive()) {
				acousticComplete = false
				gateHolding = false
				vadCompletedAt = null
			}
			if (!vad.everDetected() && bufferedBytes > PRE_SPEECH_ROLL_BYTES) {
				while (
					chunks.length > 1 &&
					bufferedBytes - (chunks[0]?.length ?? 0) >= PRE_SPEECH_ROLL_BYTES
				) {
					bufferedBytes -= chunks[0]?.length ?? 0
					chunks.shift()
				}
			}
			const silenceDone = semantic
				? vad.everDetected() &&
					!vad.speechActive() &&
					vad.holdMs() + vad.silenceMs() >= effectiveDebounceMs
				: vad.completed()
			if (
				silenceDone &&
				Date.now() < minListenUntil &&
				!(sttSession?.partial() ?? "").trim()
			)
				return
			if (silenceDone) {
				if (vadCompletedAt === null)
					satelliteGatewayLogger.info("⏱️ endpoint decision", {
						semantic,
						effectiveDebounceMs,
						vadDebounceMs,
						partialTail: (sttSession?.partial() ?? "").slice(-30),
					})
				vadCompletedAt ??=
					Date.now() -
					(semantic ? vad.holdMs() + vad.silenceMs() : vadDebounceMs)
				if (
					!semanticHintApplied &&
					acousticGateActive() &&
					!acousticComplete &&
					Date.now() - vadCompletedAt < ACOUSTIC_MAX_HOLD_MS
				) {
					gateHolding = true
					runAcousticGate()
					return
				}
				const speechEndAt = vadCompletedAt
				resetVad()
				escalatePausedBargeIn()
				transport.notifySpeechEnd?.()
				void handleUtterance(speechEndAt)
				return
			}
			if (
				!busy &&
				!spec &&
				!specStarting &&
				pausedBargeIn === null &&
				pendingInteractionId !== null &&
				sttSession !== null &&
				vad.everDetected() &&
				(wc?.satelliteSpeculationEnabled ?? false)
			) {
				specStarting = true
				const gen = utteranceGen
				const iid = pendingInteractionId
				startSatelliteSpeculation({
					identity,
					interactionId: iid,
					sttSession: () => sttSession,
					vadDebounceMs,
					bufferedPcm: () => Buffer.concat(chunks),
				})
					.then((started) => {
						specStarting = false
						if (!started) return
						if (gen !== utteranceGen || busy || pendingInteractionId !== iid) {
							started.abort("stale")
							return
						}
						spec = started
						started.done.catch(() => {
							if (spec === started) {
								spec = null
								started.release()
							}
						})
					})
					.catch((err) => {
						specStarting = false
						satelliteGatewayLogger.warn("satellite speculation start failed", {
							err,
						})
					})
			}
			spec?.feed(pcm, () => Buffer.concat(chunks))
		},

		onSpeechEnd: async () => {
			escalatePausedBargeIn()
			await handleUtterance(Date.now())
		},

		onAudioPlayed: (interactionId) => {
			if (!activeInteractionId) return
			if (interactionId !== activeInteractionId) return
			markLadderStage(activeInteractionId, "audioAudibleAt")
		},

		onCancel: () => {
			if (pausedBargeIn !== null) {
				clearTimeout(pausedBargeIn)
				pausedBargeIn = null
			}
			chunks = []
			bufferedBytes = 0
			pendingInteractionId = null
			resetVad()
			closeSttSession()
			endpointed = false
			setMicActive(false)
			minListenUntil = 0
			if (activeInteractionId) abortActiveTurn(identity.id, "satellite-cancel")
			activeFinalize?.()
		},

		onClose: () => {
			if (configRefreshTimer) {
				clearInterval(configRefreshTimer)
				configRefreshTimer = null
			}
			pendingInteractionId = null
			if (pausedBargeIn !== null) {
				clearTimeout(pausedBargeIn)
				pausedBargeIn = null
			}
			chunks = []
			bufferedBytes = 0
			resetVad()
			closeSttSession()
			endpointed = false
			busy = false
			setMicActive(false)
			if (activeInteractionId) {
				abortActiveTurn(identity.id, "satellite-disconnect")
				clearStreamingSink(activeInteractionId)
			}
			activeFinalize?.()
			if (registeredKey) {
				void stopIntercom(registeredKey)
				void stopIntercomTo(registeredKey)
				unregisterSatelliteSink(registeredKey, connectionSink)
				if (announceFn) unregisterSatelliteAnnouncer(registeredKey, announceFn)
				clearSatellitePresence(registeredKey, satelliteId, connectionId)
			}
			satelliteGatewayLogger.info("🛰️ satellite disconnected", { satelliteId })
		},
	}
}

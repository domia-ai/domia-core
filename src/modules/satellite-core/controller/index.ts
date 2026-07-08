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
	buildAudioUrl,
	registerAudioForServing,
	getAudioFilePath,
	openAudioStream,
	writeAudioStream,
	closeAudioStream,
	type StreamingSinkType,
	type TurnScopeType,
} from "@/modules/core-bus"
import { getSttEngine, type SttStreamSessionType } from "@/modules/stt-engine"
import {
	RECORDINGS_DIR,
	createVadWindow,
	type VadWindowType,
} from "@/modules/audio-capture"
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
} from "../constants"
import type { SatelliteSessionDepsType, SatelliteSessionType } from "../types"

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
	let activeInteractionId: string | null = null
	let activeFinalize: (() => void) | null = null
	let registeredKey: string | null = null
	let sttSession: SttStreamSessionType | null = null
	let sttSessionTried = false
	const connectionId = generateUuid()

	const STT_SAMPLE_RATE = 16000

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
		sttSessionTried = false
		if (!sttSession) return
		const session = sttSession
		sttSession = null
		try {
			session.abort()
		} catch {
			/* worker already released */
		}
	}

	const urlPlayback = !!transport.playAudioUrl
	const serverEndpointing = !!transport.serverEndpointing
	let vad: VadWindowType | null = null
	let endpointed = false
	let micActiveFlag = false
	const resetVad = (): void => {
		vad = null
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
		return {
			begin: async (format) => {
				release = await acquireOutput()
				try {
					setPresenceStatus(identity.domiaKey, "speaking")
					transport.beginAudio(format)
				} catch (err) {
					release?.()
					release = null
					throw err
				}
			},
			write: (chunk) => {
				onWrite?.()
				transport.writeAudio(chunk)
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
			begin: async (format) => {
				release = await acquireOutput()
				setPresenceStatus(identity.domiaKey, "speaking")
				openAudioStream(interactionId, format.sampleRate, format.channels)
			},
			write: (chunk) => {
				writeAudioStream(interactionId, chunk)
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

	const handleUtterance = async (): Promise<void> => {
		if (busy) return
		const session = sttSession
		sttSession = null
		sttSessionTried = false
		const pcm = Buffer.concat(chunks)
		chunks = []
		bufferedBytes = 0
		if (pcm.length === 0) {
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
		const interactionId = generateUuid()
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

		let finalized = false
		const finalize = (): void => {
			if (finalized) return
			finalized = true
			if (activeFinalize === finalize) activeFinalize = null
			clearTimeout(turnTimeout)
			turn?.end()
			clearInteraction(interactionId)
			if (activeInteractionId === interactionId) {
				activeInteractionId = null
				setPresenceStatus(identity.domiaKey, "idle", true)
				busy = false
				endpointed = false
			}
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
				onTranscript: (transcript) => transport.sendTranscript(transcript),
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
			transport.sendError("satellite: failed to create interaction")
			finalize()
			return
		}
		turn = handle.turn

		try {
			if (session) {
				const transcript = await session.finish()
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
				})
			} else {
				await writeFile(path, wav)
				publishToDomiaBus(identity.id, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
					filePath: path,
					interactionId,
					originDomiaKey: identity.domiaKey,
				})
			}
		} catch (err) {
			session?.abort()
			await persistTurnFailure(interactionId, err)
			transport.sendError(String(err))
			finalize()
		}
	}

	return {
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
				void intercom.sink.write(pcm)
				return
			}
			if (endpointed) return
			if (busy) {
				if (!(identity.wakeWordConfig?.bargeInEnabled ?? true)) return
				if (abortActiveTurn(identity.id, "satellite-bargein")) {
					satelliteGatewayLogger.info("🛑 satellite barge-in — turn aborted", {
						satelliteId,
						domiaKey: identity.domiaKey,
					})
				}
				activeFinalize?.()
				busy = false
				chunks = []
				bufferedBytes = 0
				resetVad()
				closeSttSession()
				setPresenceStatus(identity.domiaKey, "listening")
			}
			bufferedBytes += pcm.length
			if (bufferedBytes > MAX_UTTERANCE_BYTES) {
				satelliteGatewayLogger.warn(
					"satellite utterance exceeded max bytes — dropping",
					{ satelliteId, bufferedBytes },
				)
				chunks = []
				bufferedBytes = 0
				resetVad()
				closeSttSession()
				transport.sendError("utterance too long")
				return
			}
			chunks.push(pcm)
			setMicActive(true)

			if (!sttSession && !sttSessionTried) {
				sttSessionTried = true
				const create = streamingSttCreate()
				if (create) {
					try {
						sttSession = create(identity)
					} catch {
						sttSession = null
					}
					if (!sttSession) {
						satelliteGatewayLogger.info(
							"🛰️ streaming STT slot unavailable — batch fallback",
							{ satelliteId, domiaKey: identity.domiaKey },
						)
					}
				}
			}
			sttSession?.pushChunk(pcm)

			if (!serverEndpointing) return
			if (!vad && identity.wakeWordConfig) {
				vad = createVadWindow(identity.wakeWordConfig)
			}
			if (!vad) {
				const seconds = bufferedBytes / (sampleRate * channels * 2)
				if (seconds >= NO_VAD_MAX_UTTERANCE_S) {
					transport.notifySpeechEnd?.()
					void handleUtterance()
				}
				return
			}
			vad.feed(pcm)
			if (vad.completed()) {
				resetVad()
				transport.notifySpeechEnd?.()
				void handleUtterance()
			}
		},

		onSpeechEnd: handleUtterance,

		onCancel: () => {
			chunks = []
			bufferedBytes = 0
			resetVad()
			closeSttSession()
			endpointed = false
			setMicActive(false)
			if (activeInteractionId) abortActiveTurn(identity.id, "satellite-cancel")
			activeFinalize?.()
		},

		onClose: () => {
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

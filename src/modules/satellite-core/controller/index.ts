import { writeFile, readFile } from "fs/promises"
import { join } from "path"

import { type DomiaType, getOwnDomia, isHostedIdentity } from "@/modules/core"
import {
	INTERACTION_STATUS_ENUM,
	DEFAULT_SATELLITE_TURN_TIMEOUT_MS,
} from "@/db"
import {
	updateInteraction,
	getInteractionById,
} from "@/modules/session-manager"
import {
	requestVoiceReply,
	registerStreamingSink,
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
	type StreamingSinkType,
} from "@/modules/core-bus"
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
	let registeredKey: string | null = null

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

	const makeCaptureSink = (): StreamingSinkType => {
		let release: (() => void) | null = null
		return {
			begin: async () => {
				release = await acquireOutput()
				setPresenceStatus(identity.domiaKey, "speaking")
			},
			write: () => undefined,
			end: () => {
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
		return (await getOwnDomia(domiaKey).catch(() => null)) ?? null
	}

	const persistTurnFailure = async (
		interactionId: string,
		err: unknown,
	): Promise<void> => {
		try {
			const existing = await getInteractionById(interactionId)
			if (existing?.status === INTERACTION_STATUS_ENUM.FAILED) return
			const message = err instanceof Error ? err.message : String(err)
			await updateInteraction({
				id: interactionId,
				status: INTERACTION_STATUS_ENUM.FAILED,
				errorStep: message.includes("timeout") ? "timeout" : "satellite",
				errorMessage: message,
			})
		} catch (persistErr) {
			satelliteGatewayLogger.warn("failed to persist satellite turn failure", {
				interactionId,
				persistErr,
			})
		}
	}

	const handleUtterance = async (): Promise<void> => {
		if (busy) return
		const pcm = Buffer.concat(chunks)
		chunks = []
		bufferedBytes = 0
		if (pcm.length === 0) return
		busy = true
		if (serverEndpointing) endpointed = true
		setMicActive(false)
		if (registeredKey) {
			updateSatelliteMeta(registeredKey, satelliteId, protocol, {
				lastTurnAt: Date.now(),
			})
		}
		setPresenceStatus(identity.domiaKey, "thinking", true)
		const wav = wrapPcmToWav(pcm, sampleRate, channels, 16)
		const path = join(RECORDINGS_DIR, `satellite-${generateUuid()}.wav`)
		const interactionId = generateUuid()
		activeInteractionId = interactionId
		const turnStart = Date.now()
		let framesSent = 0
		const turnSink = urlPlayback
			? makeCaptureSink()
			: makeSink(() => {
					framesSent++
				})
		registerStreamingSink(interactionId, turnSink)
		try {
			await writeFile(path, wav)
			const result = await requestVoiceReply(identity, path, {
				speak: true,
				interactionId,
				satelliteId,
				satelliteProtocol: protocol,
				timeoutMs: DEFAULT_SATELLITE_TURN_TIMEOUT_MS,
			})
			transport.sendTranscript(result.transcript)
			let served = false
			if (urlPlayback) {
				if (result.ttsFilePath) {
					registerAudioForServing(interactionId, result.ttsFilePath)
				}
				if (getAudioFilePath(interactionId)) {
					transport.playAudioUrl?.(
						buildAudioUrl(identity, interactionId),
						interactionId,
					)
					served = true
				}
			} else if (framesSent === 0 && result.ttsFilePath) {
				await sendViaSink(turnSink, result.ttsFilePath)
				served = true
			} else if (framesSent > 0) {
				served = true
			}
			transport.sendReplyDone(result.reply, result.interactionId)
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
			satelliteGatewayLogger.error("satellite turn failed", {
				err,
				satelliteId,
				protocol,
				domiaKey: identity.domiaKey,
				interactionId,
				turnMs: Date.now() - turnStart,
			})
			await persistTurnFailure(interactionId, err)
			transport.sendError(String(err))
		} finally {
			clearStreamingSink(interactionId)
			if (activeInteractionId === interactionId) {
				activeInteractionId = null
				setPresenceStatus(identity.domiaKey, "idle", true)
				busy = false
				endpointed = false
			}
			transport.finishTurn?.()
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
			setSatellitePresence(registeredKey, satelliteId, protocol)
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
				busy = false
				chunks = []
				bufferedBytes = 0
				resetVad()
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
				transport.sendError("utterance too long")
				return
			}
			chunks.push(pcm)
			setMicActive(true)

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
			endpointed = false
			setMicActive(false)
			if (activeInteractionId) abortActiveTurn(identity.id, "satellite-cancel")
		},

		onClose: () => {
			chunks = []
			bufferedBytes = 0
			resetVad()
			endpointed = false
			busy = false
			setMicActive(false)
			if (activeInteractionId) {
				abortActiveTurn(identity.id, "satellite-disconnect")
				clearStreamingSink(activeInteractionId)
			}
			if (registeredKey) {
				void stopIntercom(registeredKey)
				void stopIntercomTo(registeredKey)
				unregisterSatelliteSink(registeredKey, connectionSink)
				if (announceFn) unregisterSatelliteAnnouncer(registeredKey, announceFn)
				clearSatellitePresence(registeredKey, satelliteId)
			}
			satelliteGatewayLogger.info("🛰️ satellite disconnected", { satelliteId })
		},
	}
}

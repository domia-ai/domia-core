import { writeFile } from "fs/promises"
import { join } from "path"

import {
	INTERACTION_STATUS_ENUM,
	DEFAULT_SATELLITE_TURN_TIMEOUT_MS,
	RESPONSE_TYPE_ENUM,
} from "@/db"
import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import {
	beginInteraction,
	clearInteraction,
	persistTerminal,
	updateSatelliteMeta,
	setPresenceStatus,
	abortActiveTurn,
	countBargeInEscalated,
	buildAudioUrl,
	registerAudioForServing,
	getAudioFilePath,
	closeAudioStream,
	type TurnScopeType,
} from "@/modules/core-bus"
import { acknowledgeEndpoint } from "@/modules/feedback-sounds"
import { RECORDINGS_DIR, matchStopPhrase } from "@/modules/audio-capture"
import {
	wrapPcmToWav,
	generateUuid,
	satelliteGatewayLogger,
	ensureTraceId,
	runWithTraceContext,
	setTraceContext,
} from "@/utils"

import type {
	SatelliteSessionDepsType,
	SatelliteSessionStateType,
} from "../types"
import type { createAcousticControls } from "./acoustic"
import { sendViaSink } from "./sinks"
import type { createSatelliteSinks } from "./sinks"

export const createUtteranceRunner = (
	state: SatelliteSessionStateType,
	deps: SatelliteSessionDepsType,
	acoustic: ReturnType<typeof createAcousticControls>,
	sinks: ReturnType<typeof createSatelliteSinks>,
) => {
	const { transport, protocol } = deps
	const { resetVad, closeSttSession, setMicActive } = acoustic
	const { makeSink, makeCaptureSink } = sinks

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
		if (state.pausedBargeIn === null) return
		clearTimeout(state.pausedBargeIn)
		state.pausedBargeIn = null
		countBargeInEscalated(state.identity.id)
		abortActiveTurn(state.identity.id, "satellite-bargein")
		state.activeFinalize?.()
		state.busy = false
	}

	const discardStopWordUtterance = (phrase: string, site: string): void => {
		if (state.pausedBargeIn !== null) {
			clearTimeout(state.pausedBargeIn)
			state.pausedBargeIn = null
		}
		abortActiveTurn(state.identity.id, "stop-word")
		state.activeFinalize?.()
		state.busy = false
		state.interruptingTurn = false
		state.echoGate?.reset()
		state.chunks = []
		state.bufferedBytes = 0
		state.pendingInteractionId = null
		resetVad()
		closeSttSession()
		setPresenceStatus(state.identity.domiaKey, "listening")
		satelliteGatewayLogger.info(
			`🛑 stop word "${phrase}" (${site}) — turn aborted, utterance discarded`,
			{ satelliteId: state.satelliteId, domiaKey: state.identity.domiaKey },
		)
	}

	const runUtterance = async (speechEndAt?: number): Promise<void> => {
		if (state.busy) return
		const endpointDecisionAt = Date.now()
		const wasInterrupting = state.interruptingTurn
		state.interruptingTurn = false
		state.echoGate?.reset()
		const owned = state.spec
		state.spec = null
		const session = state.sttSession
		state.sttSession = null
		state.sttSessionTried = false
		const pcm = Buffer.concat(state.chunks)
		state.chunks = []
		state.bufferedBytes = 0
		if (pcm.length === 0) {
			owned?.abort("empty utterance")
			session?.abort()
			return
		}
		state.busy = true
		if (state.serverEndpointing) state.endpointed = true
		setMicActive(false)
		if (state.registeredKey) {
			updateSatelliteMeta(state.registeredKey, state.satelliteId, protocol, {
				lastTurnAt: Date.now(),
			})
		}
		const wav = wrapPcmToWav(pcm, state.sampleRate, state.channels, 16)
		const path = join(RECORDINGS_DIR, `satellite-${generateUuid()}.wav`)
		const interactionId = state.pendingInteractionId ?? generateUuid()
		state.pendingInteractionId = null
		state.minListenUntil = 0
		setTraceContext({ interactionId, satelliteId: state.satelliteId })
		transport.onTurnStarted?.(interactionId)
		acknowledgeEndpoint(state.identity, interactionId, {
			playSound: false,
			sinceSpeechEndMs: speechEndAt
				? endpointDecisionAt - speechEndAt
				: undefined,
		})
		if (owned && owned.interactionId !== interactionId)
			owned.abort("interaction mismatch")
		const ownedTurn = owned?.interactionId === interactionId ? owned : null
		state.activeInteractionId = interactionId
		let turn: TurnScopeType | null = null
		const turnStart = Date.now()
		let framesSent = 0
		let streamAnnounced = false
		const turnSink = state.urlPlayback
			? makeCaptureSink(interactionId, () => {
					const url = buildAudioUrl(state.identity, interactionId)
					if (url) {
						transport.playAudioUrl?.(url, interactionId)
						streamAnnounced = true
					}
				})
			: makeSink(() => {
					framesSent++
				})
		state.ttsBytesSent = 0
		state.ttsFirstSentAt = 0

		let finalized = false
		const finalize = (): void => {
			if (finalized) return
			finalized = true
			if (state.activeFinalize === finalize) state.activeFinalize = null
			clearTimeout(turnTimeout)
			closeAudioStream(interactionId)
			turn?.end()
			clearInteraction(interactionId)
			if (state.activeInteractionId === interactionId) {
				state.activeInteractionId = null
				setPresenceStatus(state.identity.domiaKey, "idle", true)
				state.busy = false
				state.interruptingTurn = false
				state.echoGate?.reset()
				state.endpointed = false
			}
			transport.onTurnFinished?.(interactionId)
			transport.finishTurn?.()
		}
		state.activeFinalize = finalize
		const turnTimeout = setTimeout(() => {
			abortActiveTurn(state.identity.id, "satellite-timeout")
			void persistTurnFailure(
				interactionId,
				new Error("satellite turn timeout"),
			)
			transport.sendError("satellite turn timeout")
			finalize()
		}, DEFAULT_SATELLITE_TURN_TIMEOUT_MS)

		const inputAudioMs = Math.round(
			(pcm.length / (state.sampleRate * state.channels * 2)) * 1000,
		)

		const handle = await beginInteraction(
			state.identity,
			{
				input: { kind: "audio_file", filePath: path, inputAudioMs },
				requestedOutput: { kind: "voice" },
				source: "satellite",
				interactionId,
				satelliteId: state.satelliteId,
				satelliteProtocol: protocol,
			},
			{
				audioDelivery: state.urlPlayback ? "audio-url" : "streaming-sink",
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
							if (state.urlPlayback) {
								if (result.ttsFilePath) {
									registerAudioForServing(interactionId, result.ttsFilePath)
								}
								if (streamAnnounced) {
									served = true
								} else {
									const audioUrl = getAudioFilePath(interactionId)
										? buildAudioUrl(state.identity, interactionId)
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
								satelliteId: state.satelliteId,
								protocol,
								domiaKey: state.identity.domiaKey,
								interactionId,
								transcriptChars: result.transcript.trim().length,
								replyChars: result.reply.trim().length,
								served,
								turnMs: Date.now() - turnStart,
							})
						} catch (err) {
							satelliteGatewayLogger.error("satellite onComplete failed", {
								err,
								satelliteId: state.satelliteId,
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
								satelliteId: state.satelliteId,
								protocol,
								domiaKey: state.identity.domiaKey,
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
				void ownedTurn.done.catch((err: unknown) => {
					satelliteGatewayLogger.warn(
						"speculative turn failed post-handoff — batch fallback",
						{ err, interactionId },
					)
					ownedTurn.release()
					publishToDomiaBus(
						state.identity.id,
						DOMIA_EVENT_BUS_ENUM.AUDIO_READY,
						{
							filePath: path,
							interactionId,
							originDomiaKey: state.identity.domiaKey,
							speechEndAt,
							endpointDecisionAt,
							endpointDebounceMs: state.vadDebounceMs || undefined,
						},
					)
				})
			} else if (session) {
				const flushStart = Date.now()
				const usePartial =
					state.identity.sttConfig?.partialAtEndpointEnabled === true
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
				const stopPhrase =
					wasInterrupting && state.identity.wakeWordConfig?.stopWordAbortEnabled
						? matchStopPhrase(
								transcript,
								state.identity.characterProfile?.language,
								state.identity.wakeWordConfig.stopWordMaxWords,
								state.identity.wakeWordConfig.stopWordMaxExtraWords,
							)
						: null
				if (stopPhrase !== null) {
					satelliteGatewayLogger.info(
						`🛑 stop word "${stopPhrase}" (final) — utterance discarded`,
						{
							satelliteId: state.satelliteId,
							domiaKey: state.identity.domiaKey,
							interactionId,
						},
					)
					await persistTerminal(
						interactionId,
						INTERACTION_STATUS_ENUM.ABORTED,
						{ errorStep: "stop-word" },
					)
					finalize()
					return
				}
				void writeFile(path, wav).catch((err: unknown) =>
					satelliteGatewayLogger.warn("satellite audio archive write failed", {
						path,
						err,
					}),
				)
				publishToDomiaBus(state.identity.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
					transcript,
					interactionId,
					originDomiaKey: state.identity.domiaKey,
					responseType: RESPONSE_TYPE_ENUM.VOICE,
					speechEndAt,
					endpointDecisionAt,
					endpointDebounceMs: state.vadDebounceMs || undefined,
				})
			} else {
				await writeFile(path, wav)
				publishToDomiaBus(state.identity.id, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
					filePath: path,
					interactionId,
					originDomiaKey: state.identity.domiaKey,
					speechEndAt,
					endpointDecisionAt,
					endpointDebounceMs: state.vadDebounceMs || undefined,
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

	const handleUtterance = (speechEndAt?: number): Promise<void> =>
		runWithTraceContext(
			{ originDomiaKey: state.identity.domiaKey, traceId: ensureTraceId() },
			() => runUtterance(speechEndAt),
		)

	return {
		escalatePausedBargeIn,
		discardStopWordUtterance,
		handleUtterance,
	}
}

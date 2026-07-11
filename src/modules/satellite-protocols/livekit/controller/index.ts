import {
	AudioFrame,
	AudioResampler,
	AudioResamplerQuality,
	AudioSource,
	AudioStream,
	LocalAudioTrack,
	Room,
	RoomEvent,
	TrackKind,
	TrackPublishOptions,
	TrackSource,
	type Track,
} from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"

import { type DomiaType } from "@/modules/core"
import {
	createSatelliteSession,
	createReconnectScheduler,
	type SatelliteTransportType,
} from "@/modules/satellite-core"
import { setSatelliteConnecting, setSatelliteError } from "@/modules/core-bus"
import { satelliteLivekitLogger } from "@/utils"

import type {
	LivekitSatelliteConfigType,
	LivekitSatelliteHandleType,
	LivekitOutputStateType,
} from "../types"

const RECONNECT_MS = 3000
const PACE_MAX_QUEUED_S = 0.25
const INPUT_SAMPLE_RATE = 16000
const INPUT_CHANNELS = 1
const TTS_TRACK_NAME = "domia-tts"

const gatePauseAudio = (): boolean => true
const gateResumeAudio = (): boolean => true

const pcmToInt16 = (chunk: Buffer): Int16Array => {
	const samples = new Int16Array(Math.floor(chunk.byteLength / 2))
	chunk.copy(Buffer.from(samples.buffer), 0, 0, samples.length * 2)
	return samples
}

const mintToken = async (
	config: LivekitSatelliteConfigType,
	identity: string,
): Promise<string> => {
	const token = new AccessToken(config.apiKey, config.apiSecret, {
		identity,
		name: config.name ?? undefined,
	})
	token.addGrant({
		roomJoin: true,
		room: config.roomName,
		canPublish: true,
		canSubscribe: true,
	})
	return token.toJwt()
}

export const connectLivekitSatellite = (
	config: LivekitSatelliteConfigType,
	fallback: DomiaType,
	domiaKey?: string,
): LivekitSatelliteHandleType => {
	const presenceKey = domiaKey ?? fallback.domiaKey
	const scheduler = createReconnectScheduler(RECONNECT_MS)
	let closeCurrent: (() => void) | null = null

	const openRoom = async (): Promise<void> => {
		setSatelliteConnecting(presenceKey, config.satelliteId, "livekit")
		const token = await mintToken(config, `domia-${presenceKey}`)
		const room = new Room()

		let output: LivekitOutputStateType | null = null
		let stopInputPump: (() => void) | null = null
		let inputFormatSent = false
		let cleaned = false
		let markHelloReady: () => void = () => undefined
		const helloReady = new Promise<void>((resolve) => {
			markHelloReady = resolve
		})

		const sendData = (topic: string, payload: string): void => {
			void room.localParticipant
				?.publishData(new TextEncoder().encode(payload), {
					reliable: true,
					topic,
				})
				.catch((err: unknown) =>
					satelliteLivekitLogger.warn("livekit data publish failed", {
						satelliteId: config.satelliteId,
						topic,
						err,
					}),
				)
		}

		const teardownOutput = async (
			out: LivekitOutputStateType,
		): Promise<void> => {
			const publication = await out.ready.catch(() => null)
			if (publication?.sid) {
				await room.localParticipant
					?.unpublishTrack(publication.sid)
					.catch(() => undefined)
			}
			await out.source.close().catch(() => undefined)
		}

		const closeOutput = (): Promise<void> => {
			const out = output
			output = null
			return out ? teardownOutput(out) : Promise.resolve()
		}

		const transport: SatelliteTransportType = {
			sendReady: () => undefined,
			sendTranscript: (text) => sendData("transcript", text),
			sendReplyDone: () => undefined,
			sendError: (message) => {
				satelliteLivekitLogger.warn("turn error", {
					satelliteId: config.satelliteId,
					message,
				})
				sendData("error", message)
			},
			serverEndpointing: true,
			beginAudio: (format) => {
				if (
					output &&
					output.format.sampleRate === format.sampleRate &&
					output.format.channels === format.channels
				)
					return
				const stale = output
				const source = new AudioSource(format.sampleRate, format.channels)
				const track = LocalAudioTrack.createAudioTrack(TTS_TRACK_NAME, source)
				const ready = (async () => {
					if (stale) await teardownOutput(stale)
					const local = room.localParticipant
					if (!local) throw new Error("livekit room has no local participant")
					return local.publishTrack(
						track,
						new TrackPublishOptions({
							source: TrackSource.SOURCE_MICROPHONE,
						}),
					)
				})()
				ready.catch(() => undefined)
				output = { source, format, ready }
			},
			writeAudio: async (chunk) => {
				const out = output
				if (!out) return
				await out.ready
				const samples = pcmToInt16(chunk)
				const samplesPerChannel = Math.floor(
					samples.length / out.format.channels,
				)
				if (samplesPerChannel === 0) return
				while (out.source.queuedDuration > PACE_MAX_QUEUED_S) {
					await new Promise((r) => setTimeout(r, 50))
				}
				await out.source.captureFrame(
					new AudioFrame(
						samples,
						out.format.sampleRate,
						out.format.channels,
						samplesPerChannel,
					),
				)
			},
			endAudio: () => undefined,
			pauseAudio: gatePauseAudio,
			resumeAudio: gateResumeAudio,
			close: () => {
				void room.disconnect().catch(() => undefined)
			},
			outputCapabilities: {
				pause: true,
				position: "estimated",
				urlPlayback: false,
				captions: true,
			},
		}

		const session = createSatelliteSession({
			fallback,
			transport,
			protocol: "livekit",
		})

		const startInputPump = (track: Track): void => {
			stopInputPump?.()
			satelliteLivekitLogger.info("🎙️ livekit input track subscribed", {
				satelliteId: config.satelliteId,
			})
			const stream = new AudioStream(track)
			const reader = stream.getReader()
			let stopped = false
			let frames = 0
			let resampler: AudioResampler | null = null
			let resamplerRate = 0
			const closeResampler = (): void => {
				resampler?.close()
				resampler = null
			}
			const downmix = (frame: AudioFrame): AudioFrame => {
				if (frame.channels === INPUT_CHANNELS) return frame
				const mono = new Int16Array(frame.samplesPerChannel)
				for (let i = 0; i < frame.samplesPerChannel; i++) {
					let acc = 0
					for (let c = 0; c < frame.channels; c++)
						acc += frame.data[i * frame.channels + c] ?? 0
					mono[i] = Math.round(acc / frame.channels)
				}
				return new AudioFrame(
					mono,
					frame.sampleRate,
					1,
					frame.samplesPerChannel,
				)
			}
			const toInputRate = (frame: AudioFrame): AudioFrame[] => {
				const mono = downmix(frame)
				if (mono.sampleRate === INPUT_SAMPLE_RATE) return [mono]
				if (!resampler || resamplerRate !== mono.sampleRate) {
					closeResampler()
					resampler = new AudioResampler(
						mono.sampleRate,
						INPUT_SAMPLE_RATE,
						INPUT_CHANNELS,
						AudioResamplerQuality.MEDIUM,
					)
					resamplerRate = mono.sampleRate
				}
				return resampler.push(mono)
			}
			stopInputPump = () => {
				stopped = true
				void reader.cancel().catch(() => undefined)
			}
			void (async () => {
				await helloReady
				if (stopped) return
				if (!inputFormatSent) {
					inputFormatSent = true
					session.setFormat(INPUT_SAMPLE_RATE, INPUT_CHANNELS)
				}
				for (;;) {
					const { done, value: frame } = await reader.read()
					if (done || stopped || !frame) break
					frames++
					for (const resampled of toInputRate(frame)) {
						session.onAudio(
							Buffer.from(
								resampled.data.buffer,
								resampled.data.byteOffset,
								resampled.data.byteLength,
							),
						)
					}
				}
				closeResampler()
				satelliteLivekitLogger.info("🎙️ livekit input pump ended", {
					satelliteId: config.satelliteId,
					frames,
				})
			})().catch((err: unknown) =>
				satelliteLivekitLogger.warn("livekit input stream failed", {
					satelliteId: config.satelliteId,
					err,
				}),
			)
		}

		const cleanup = (): void => {
			if (cleaned) return
			cleaned = true
			markHelloReady()
			stopInputPump?.()
			stopInputPump = null
			void closeOutput()
			session.onClose()
			if (closeCurrent === disconnect) closeCurrent = null
		}

		const disconnect = (): void => {
			cleanup()
			void room.disconnect().catch(() => undefined)
		}

		room.on(RoomEvent.TrackSubscribed, (track) => {
			if (track.kind === TrackKind.KIND_AUDIO) startInputPump(track)
		})
		room.on(RoomEvent.Disconnected, (reason) => {
			satelliteLivekitLogger.info("🛰️ livekit room disconnected", {
				satelliteId: config.satelliteId,
				roomName: config.roomName,
				reason,
			})
			cleanup()
			if (!scheduler.isClosed()) scheduler.schedule(open)
		})

		await room.connect(config.url, token, {
			autoSubscribe: true,
			dynacast: false,
		})
		closeCurrent = disconnect
		scheduler.reset()
		satelliteLivekitLogger.info("🛰️ connected to livekit room", {
			url: config.url,
			roomName: config.roomName,
			domiaKey,
		})
		session
			.onHello({ domiaKey, satelliteId: config.satelliteId })
			.then(markHelloReady)
			.catch(markHelloReady)

		for (const participant of room.remoteParticipants.values()) {
			for (const publication of participant.trackPublications.values()) {
				if (
					publication.track &&
					publication.track.kind === TrackKind.KIND_AUDIO
				) {
					startInputPump(publication.track)
				}
			}
		}
	}

	const open = (): void => {
		if (scheduler.isClosed()) return
		void openRoom().catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err)
			setSatelliteError(presenceKey, config.satelliteId, "livekit", message)
			satelliteLivekitLogger.warn("livekit connect failed", {
				url: config.url,
				roomName: config.roomName,
				err: message,
			})
			if (!scheduler.isClosed()) scheduler.schedule(open)
		})
	}

	open()

	return {
		close: () => scheduler.close(() => closeCurrent?.()),
	}
}

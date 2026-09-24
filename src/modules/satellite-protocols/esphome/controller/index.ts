import {
	type DomiaType,
	invalidateOwnDomia,
	setSatelliteDesiredVolume,
} from "@/modules/core"
import {
	createSatelliteSession,
	createReconnectScheduler,
	type SatelliteTransportType,
} from "@/modules/satellite-core"
import {
	setPresenceStatus,
	getPresence,
	getAudioFilePath,
	withAudioFormat,
	setSatelliteConnecting,
	setSatelliteError,
	updateSatelliteMeta,
	registerSatelliteControl,
	unregisterSatelliteControl,
	type SatelliteWakeWordType,
	type SatelliteNumberEntityType,
} from "@/modules/core-bus"
import {
	externalMediaKey,
	noteExternalMedia,
	clearExternalMedia,
	isExternalMediaPlaying,
	registerExternalMediaControls,
	unregisterExternalMediaControls,
	type ExternalMediaControlsType,
} from "@/modules/audio-playback"
import {
	DEFAULT_SATELLITE_LIVENESS_PING_MS,
	DEFAULT_SATELLITE_LIVENESS_TIMEOUT_MS,
	DEFAULT_SATELLITE_RECONNECT_MS,
	VOLUME_PERCENT_SCALE,
} from "@/db"
import {
	satelliteEsphomeLogger as logger,
	getWavDurationMs,
	type AudioDeliveryFormatType,
} from "@/utils"

import type { Entity, NumberEvent } from "esphome-client"
import { createEsphomeRunController } from "./run-controller"
import { mediaPlayerFormatsOf, playbackFormatOf } from "../utils"
import type {
	EsphomeAudioFormatType,
	EsphomeModuleType,
	EsphomeBindingType,
	EsphomeSatelliteHandleType,
	NumberEntityInfoType,
	RunControllerType,
} from "../types"

const isNumberEntity = (
	e: Entity & { id: string },
): e is NumberEntityInfoType => e.type === "number"

let esphomeModule: EsphomeModuleType | null = null
const getEsphome = async (): Promise<EsphomeModuleType> =>
	(esphomeModule ??= await import("esphome-client"))

export const connectEsphomeSatellite = (
	binding: EsphomeBindingType,
	fallback: DomiaType,
	domiaKey?: string,
	esphomeOverride?: EsphomeModuleType,
): EsphomeSatelliteHandleType => {
	const presenceKey = domiaKey ?? fallback.domiaKey
	const mediaKey = externalMediaKey(presenceKey, binding.satelliteId)
	const scheduler = createReconnectScheduler(DEFAULT_SATELLITE_RECONNECT_MS)
	let client: { disconnect: () => void } | null = null
	let reconnectCount = 0
	let desiredWakeWords = binding.desiredWakeWords
		? [...binding.desiredWakeWords]
		: []
	const desiredNumbers: Record<string, number> = {
		...(binding.desiredNumbers ?? {}),
	}
	let followUpEnabled = binding.followUpEnabled
	let lastTranscriptChars = 0
	let runController: RunControllerType | null = null
	let configVerifyTimer: ReturnType<typeof setTimeout> | null = null
	let configVerifyFailures = 0
	const shouldFollowUp = () => followUpEnabled && lastTranscriptChars > 0
	const SPEAKING_FALLBACK_MS = 15_000
	const SPEAKING_DURATION_SLACK_MS = 1_000
	let speakingResetTimer: ReturnType<typeof setTimeout> | null = null
	const armSpeakingReset = (durationMs: number | null): void => {
		const resetMs =
			durationMs !== null
				? durationMs +
					binding.playbackDrainMarginMs +
					SPEAKING_DURATION_SLACK_MS
				: SPEAKING_FALLBACK_MS
		if (speakingResetTimer) clearTimeout(speakingResetTimer)
		speakingResetTimer = setTimeout(() => {
			if (getPresence(presenceKey)?.status === "speaking")
				setPresenceStatus(presenceKey, "idle", true)
		}, resetMs)
		speakingResetTimer.unref()
	}
	const markDeviceSpeaking = (durationMs: number | null): void => {
		logger.info("📢 device announce started", {
			satelliteId: binding.satelliteId,
		})
		setPresenceStatus(presenceKey, "speaking")
		armSpeakingReset(durationMs)
	}
	const clearDeviceSpeaking = (): void => {
		logger.info("📢 device announce finished", {
			satelliteId: binding.satelliteId,
		})
		if (speakingResetTimer) {
			clearTimeout(speakingResetTimer)
			speakingResetTimer = null
		}
		if (getPresence(presenceKey)?.status === "speaking")
			setPresenceStatus(presenceKey, "idle", true)
	}
	let numberEntities: SatelliteNumberEntityType[] = []
	let mediaPlayerId: string | null = null
	let playbackFormat: AudioDeliveryFormatType | null = null
	const formatsByEntityKey = new Map<number, EsphomeAudioFormatType[]>()
	const forDevice = (url: string): string =>
		playbackFormat ? withAudioFormat(url, playbackFormat) : url
	let desiredVolume = binding.desiredVolume ?? null
	let deviceVolume: number | null = null
	const idByKey = new Map<number, string>()
	const publishNumbers = () =>
		updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
			numberEntities,
		})

	const open = async (): Promise<void> => {
		if (scheduler.isClosed()) return
		const {
			EspHomeClient,
			VoiceAssistantSubscribeFlag,
			VoiceAssistantEvent,
			VoiceAssistantTimerEvent,
			MediaPlayerCommand,
		} = esphomeOverride ?? (await getEsphome())

		const TIMER_EVENT_TO_ESPHOME = {
			started: VoiceAssistantTimerEvent.STARTED,
			updated: VoiceAssistantTimerEvent.UPDATED,
			cancelled: VoiceAssistantTimerEvent.CANCELLED,
			finished: VoiceAssistantTimerEvent.FINISHED,
		}
		if (scheduler.isClosed()) return

		const esp = new EspHomeClient({
			host: binding.host,
			port: binding.port,
			psk: binding.encryptionKey,
			clientId: "domia",
		})
		client = esp
		let lastReceivedAt = Date.now()
		const liveness = setInterval(() => {
			const silentMs = Date.now() - lastReceivedAt
			if (silentMs >= DEFAULT_SATELLITE_LIVENESS_TIMEOUT_MS) {
				logger.warn("esphome satellite silent — forcing reconnect", {
					host: binding.host,
					silentMs,
				})
				clearInterval(liveness)
				esp.disconnect()
				return
			}
			if (silentMs >= DEFAULT_SATELLITE_LIVENESS_PING_MS) esp.sendPing()
		}, DEFAULT_SATELLITE_LIVENESS_PING_MS)
		liveness.unref()

		const event = (type: number, data?: { name: string; value: string }[]) =>
			esp.sendVoiceAssistantEvent(type, data)

		const applyVolume = (volume: number): number => {
			const clamped = Math.min(1, Math.max(0, volume))
			desiredVolume = clamped
			if (mediaPlayerId)
				esp.sendMediaPlayerCommand(mediaPlayerId, { volume: clamped })
			updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
				volume: clamped,
			})
			return clamped
		}

		const controls: ExternalMediaControlsType = {
			origin: "transport",
			setVolume: async (level) => {
				const clamped = applyVolume(level / VOLUME_PERCENT_SCALE)
				if (binding.domiaId) {
					await setSatelliteDesiredVolume(
						binding.domiaId,
						binding.satelliteId,
						clamped,
					)
					invalidateOwnDomia(presenceKey)
				}
				return mediaPlayerId !== null
			},
			getVolume: () => {
				const level = desiredVolume ?? deviceVolume
				return level === null ? null : Math.round(level * VOLUME_PERCENT_SCALE)
			},
		}

		runController?.dispose()
		let captureGateUntil = 0
		const interactionTokens = new Map<string, number>()
		let sessionRef: ReturnType<typeof createSatelliteSession> | null = null
		const rc = createEsphomeRunController({
			satelliteId: binding.satelliteId,
			sendEvent: event,
			respondToRequest: (error) => esp.sendVoiceAssistantResponse(0, error),
			sendAnnounce: (url, startConversation) =>
				esp.sendVoiceAssistantAnnounce(
					startConversation
						? { mediaId: url, startConversation: true }
						: { mediaId: url },
				),
			stopMedia: () => {
				if (!mediaPlayerId) return false
				esp.sendMediaPlayerCommand(mediaPlayerId, {
					command: MediaPlayerCommand.STOP,
					announcement: true,
				})
				return true
			},
			externalMediaPlaying: () => isExternalMediaPlaying(mediaKey),
			events: {
				runStart: VoiceAssistantEvent.RUN_START,
				runEnd: VoiceAssistantEvent.RUN_END,
				sttVadEnd: VoiceAssistantEvent.STT_VAD_END,
				error: VoiceAssistantEvent.ERROR,
				sttStart: VoiceAssistantEvent.STT_START,
				intentStart: VoiceAssistantEvent.INTENT_START,
				intentEnd: VoiceAssistantEvent.INTENT_END,
				ttsStart: VoiceAssistantEvent.TTS_START,
				ttsEnd: VoiceAssistantEvent.TTS_END,
				sttEnd: VoiceAssistantEvent.STT_END,
			},
			budgets: {
				listeningMaxMs: binding.runListeningMaxMs,
				followUpNoSpeechMs: binding.followUpNoSpeechMs,
				drainMarginMs: binding.playbackDrainMarginMs,
				followUpRequestMaxMs: binding.followUpRequestMaxMs,
				processingMaxMs: 30000,
			},
			onRunAccepted: (followUpRun, minListenMs, muteMs) => {
				setPresenceStatus(presenceKey, "listening")
				if (followUpRun && minListenMs > 0)
					sessionRef?.setMinListenUntil(Date.now() + minListenMs)
				const gateMs = followUpRun ? muteMs : binding.captureHeadTrimMs
				captureGateUntil = gateMs > 0 ? Date.now() + gateMs : 0
			},
			onRunCancelled: () => sessionRef?.onCancel(),
			hasPendingSpeech: () => sessionRef?.hasPendingUtterance() ?? false,
			onRunClosed: () => {
				if (getPresence(presenceKey)?.status !== "speaking")
					setPresenceStatus(presenceKey, "idle", true)
			},
			onPlaybackStart: (durationMs) => markDeviceSpeaking(durationMs),
			onPlaybackDurationKnown: (durationMs) => {
				if (getPresence(presenceKey)?.status === "speaking")
					armSpeakingReset(durationMs)
			},
			onPlaybackEnd: () => clearDeviceSpeaking(),
		})
		runController = rc

		const patchDurationFromUrl = (
			generation: number | null,
			url: string,
		): void => {
			if (generation === null) return
			const servedId = url.split("/").pop()
			const filePath = servedId ? getAudioFilePath(servedId) : undefined
			if (!filePath) return
			void getWavDurationMs(filePath)
				.catch((err: unknown) => {
					logger.warn("wav duration probe failed", { err, filePath })
					return null
				})
				.then((durationMs) => rc.updatePlaybackDuration(generation, durationMs))
		}

		const pendingReplyDurations = new Map<string, number>()
		const patchReplyDuration = (
			generation: number,
			interactionId: string,
		): boolean => {
			const filePath = getAudioFilePath(interactionId)
			if (!filePath) return false
			void getWavDurationMs(filePath)
				.catch((err: unknown) => {
					logger.warn("wav duration probe failed", { err, filePath })
					return null
				})
				.then((durationMs) => rc.updatePlaybackDuration(generation, durationMs))
			return true
		}

		const transport: SatelliteTransportType = {
			sendReady: () => undefined,
			onTurnFinished: (interactionId) => {
				interactionTokens.delete(interactionId)
				const generation = pendingReplyDurations.get(interactionId)
				if (generation === undefined) return
				pendingReplyDurations.delete(interactionId)
				patchReplyDuration(generation, interactionId)
			},
			onTurnStarted: (interactionId) => {
				interactionTokens.set(interactionId, rc.currentGeneration())
				if (interactionTokens.size > 6) {
					const first = interactionTokens.keys().next().value
					if (first !== undefined) interactionTokens.delete(first)
				}
			},
			sendTranscript: (text, interactionId) => {
				const mapped = interactionTokens.get(interactionId)
				if (mapped === undefined) {
					logger.info("🎛️ transcript without run mapping dropped", {
						satelliteId: binding.satelliteId,
						interactionId,
					})
					return
				}
				if (mapped !== rc.currentGeneration()) {
					logger.info("🎛️ stale transcript dropped (mapped mismatch)", {
						satelliteId: binding.satelliteId,
						interactionId,
						mapped,
						current: rc.currentGeneration(),
					})
					return
				}
				lastTranscriptChars = text.trim().length
				rc.onTranscript(text)
			},
			sendReplyDone: () => undefined,
			sendError: (message) =>
				event(VoiceAssistantEvent.ERROR, [{ name: "message", value: message }]),
			beginAudio: () => undefined,
			writeAudio: () => undefined,
			endAudio: () => undefined,
			close: () => esp.disconnect(),
			serverEndpointing: true,
			notifySpeechEnd: () => rc.notifySpeechEnd(),
			playAudioUrl: (url, interactionId) => {
				const followUp = shouldFollowUp()
				const generation = rc.enqueuePlayback(
					forDevice(url),
					"reply",
					followUp,
					null,
					interactionTokens.get(interactionId) ?? null,
				)

				if (generation === null) return
				if (!patchReplyDuration(generation, interactionId))
					pendingReplyDurations.set(interactionId, generation)
			},
			announce: (url) => {
				const generation = rc.enqueuePlayback(
					forDevice(url),
					"announce",
					false,
					null,
				)
				patchDurationFromUrl(generation, url)
			},
			pauseAudio: () => {
				if (!mediaPlayerId) return false
				esp.sendMediaPlayerCommand(mediaPlayerId, {
					command: MediaPlayerCommand.PAUSE,
					announcement: true,
				})
				return true
			},
			resumeAudio: () => {
				if (!mediaPlayerId) return false
				esp.sendMediaPlayerCommand(mediaPlayerId, {
					command: MediaPlayerCommand.PLAY,
					announcement: true,
				})
				return true
			},
			outputCapabilities: {
				pause: true,
				position: "sentence",
				urlPlayback: true,
				captions: false,
			},
			finishTurn: () => rc.finishTurn(),
			externalMediaPlaying: () => isExternalMediaPlaying(mediaKey),
			followUp: true,
		}

		const session = createSatelliteSession({
			fallback,
			transport,
			protocol: "esphome",
		})
		sessionRef = session

		esp.on("connect", () => {
			scheduler.reset()
			esp.subscribeVoiceAssistant(VoiceAssistantSubscribeFlag.API_AUDIO)
			logger.info("🛰️ connected to esphome satellite", {
				host: binding.host,
				satelliteId: binding.satelliteId,
				domiaKey,
			})
			updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
				reconnectCount,
			})
			registerSatelliteControl({
				satelliteId: binding.satelliteId,
				domiaKey: presenceKey,
				setWakeWords: (ids) => {
					desiredWakeWords = [...ids]
					esp.setVoiceAssistantConfiguration(ids)
					esp.requestVoiceAssistantConfiguration()
				},
				announce: (url) => {
					const generation = rc.enqueuePlayback(
						forDevice(url),
						"announce",
						false,
						null,
					)
					patchDurationFromUrl(generation, url)
				},
				startConversation: (url) => {
					const generation = rc.enqueuePlayback(
						forDevice(url),
						"announce",
						true,
						null,
					)
					patchDurationFromUrl(generation, url)
				},
				setNumber: (entityId, value) => {
					desiredNumbers[entityId] = value
					esp.sendNumberCommand(entityId, value)
					const entity = numberEntities.find((n) => n.id === entityId)
					if (entity) {
						entity.value = value
						publishNumbers()
					}
				},
				setVolume: (volume) => {
					applyVolume(volume)
				},
				sendTimerEvent: (evt) =>
					esp.sendVoiceAssistantTimerEvent({
						eventType: TIMER_EVENT_TO_ESPHOME[evt.eventType],
						timerId: evt.timerId,
						name: evt.name,
						totalSeconds: evt.totalSeconds,
						secondsLeft: evt.secondsLeft,
						isActive: evt.isActive,
					}),
				setFollowUp: (enabled) => {
					followUpEnabled = enabled
				},
			})
			esp.requestVoiceAssistantConfiguration()
			if (configVerifyTimer) clearTimeout(configVerifyTimer)
			configVerifyTimer = setTimeout(() => {
				configVerifyFailures++
				if (configVerifyFailures >= 3) {
					logger.error(
						"❌ ownership_conflict — staying connected without VA (no reconnect storm)",
						{
							satelliteId: binding.satelliteId,
							failures: configVerifyFailures,
						},
					)
					return
				}
				{
					logger.warn("⚠️ VA subscription unverified — bouncing connection", {
						satelliteId: binding.satelliteId,
						failures: configVerifyFailures,
					})
				}
				esp.disconnect()
			}, 5000)
			configVerifyTimer.unref()
			void session.onHello({ domiaKey, satelliteId: binding.satelliteId })
		})

		esp.on("deviceInfo", (info) => {
			const version = info.esphomeVersion ?? info.projectVersion ?? null
			if (!version) return
			updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
				firmwareVersion: version,
			})
		})

		esp.on("voiceAssistantConfiguration", (config) => {
			if (config.availableWakeWords.length > 0) {
				if (configVerifyTimer) clearTimeout(configVerifyTimer)
				configVerifyTimer = null
				configVerifyFailures = 0
			}
			const available: SatelliteWakeWordType[] = config.availableWakeWords.map(
				(w) => ({ id: w.id, wakeWord: w.wakeWord }),
			)
			updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
				availableWakeWords: available,
				activeWakeWords: config.activeWakeWords,
			})
			const sameSet =
				desiredWakeWords.length === config.activeWakeWords.length &&
				desiredWakeWords.every((id) => config.activeWakeWords.includes(id))
			if (desiredWakeWords.length > 0 && !sameSet) {
				logger.info("🛰️ applying desired wake words", {
					satelliteId: binding.satelliteId,
					desired: desiredWakeWords,
				})
				esp.setVoiceAssistantConfiguration(desiredWakeWords)
			}
		})

		esp.on(
			"message",
			({ type, payload }: { type: number; payload: Buffer }) => {
				lastReceivedAt = Date.now()
				const advertised = mediaPlayerFormatsOf(type, payload)
				if (advertised?.key !== null && advertised?.key !== undefined)
					formatsByEntityKey.set(advertised.key, advertised.formats)
			},
		)

		esp.on("entities", () => {
			const withIds = esp.getEntitiesWithIds()
			const mp = withIds.find((e) => e.type === "media_player")
			mediaPlayerId = mp?.id ?? null
			const formats = mp ? (formatsByEntityKey.get(mp.key) ?? []) : []
			playbackFormat = playbackFormatOf(formats)
			if (playbackFormat)
				logger.info("🎚️ device playback format", {
					satelliteId: binding.satelliteId,
					playbackFormat,
					formats,
				})
			if (mediaPlayerId) registerExternalMediaControls(mediaKey, controls)
			else unregisterExternalMediaControls(mediaKey)
			if (mediaPlayerId && desiredVolume !== null)
				esp.sendMediaPlayerCommand(mediaPlayerId, { volume: desiredVolume })
			const nums = withIds.filter(isNumberEntity)
			idByKey.clear()
			numberEntities = nums.map((e) => {
				idByKey.set(e.key, e.id)
				return {
					id: e.id,
					name: e.name,
					value: desiredNumbers[e.id] ?? null,
					min: e.minValue ?? null,
					max: e.maxValue ?? null,
					step: e.step ?? null,
					unit: e.unitOfMeasurement ?? null,
				}
			})
			publishNumbers()
			for (const [id, value] of Object.entries(desiredNumbers)) {
				if (numberEntities.some((n) => n.id === id)) {
					esp.sendNumberCommand(id, value)
				}
			}
		})

		esp.on("number", (evt: NumberEvent) => {
			const id = idByKey.get(evt.key)
			if (!id) return
			const entity = numberEntities.find((n) => n.id === id)
			if (!entity) return
			entity.value = evt.state ?? entity.value
			publishNumbers()
		})

		esp.on("telemetry", (payload) => {
			const evt = payload as unknown as {
				type?: string
				volume?: number
				state?: number
			}
			if (evt.type !== "media_player") return
			if (typeof evt.state === "number") {
				logger.debug("🔬 media_player state", {
					satelliteId: binding.satelliteId,
					state: evt.state,
				})
				const verdict = rc.onMediaState(evt.state)
				if (verdict.external)
					noteExternalMedia(mediaKey, verdict.external === "playing")
			}
			if (typeof evt.volume === "number") {
				deviceVolume = evt.volume
				desiredVolume = evt.volume
				updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
					volume: evt.volume,
				})
			}
		})

		esp.on("voiceAssistantAnnounceFinished", () => {
			rc.onAnnounceFinished()
			updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
				lastPlaybackAt: Date.now(),
			})
		})

		esp.on("voiceAssistantRequest", (req: { start?: boolean }) => {
			lastTranscriptChars = 0
			rc.onRequest(!!req.start)
		})

		esp.on("voiceAssistantAudio", (audio: { data: Buffer; end: boolean }) => {
			if (audio.data.length && Date.now() >= captureGateUntil)
				session.onAudio(audio.data)
			if (audio.end) void session.onSpeechEnd()
		})

		esp.on("disconnect", (reason?: string) => {
			clearInterval(liveness)
			lastTranscriptChars = 0
			rc.dispose()
			clearExternalMedia(mediaKey)
			unregisterExternalMediaControls(mediaKey)
			mediaPlayerId = null
			playbackFormat = null
			formatsByEntityKey.clear()
			if (configVerifyTimer) clearTimeout(configVerifyTimer)
			configVerifyTimer = null
			session.onClose()
			unregisterSatelliteControl(presenceKey, binding.satelliteId)
			client = null
			if (!scheduler.isClosed()) {
				reconnectCount++
				logger.warn("esphome satellite disconnected — reconnecting", {
					host: binding.host,
					reason,
				})
				setSatelliteError(
					presenceKey,
					binding.satelliteId,
					"esphome",
					reason ?? "disconnected",
				)
				scheduler.schedule(safeOpen)
			}
		})

		setSatelliteConnecting(presenceKey, binding.satelliteId, "esphome")
		esp.connect()
	}

	const safeOpen = (): void => {
		open().catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err)
			logger.warn("esphome open failed — retrying", {
				host: binding.host,
				err: message,
			})
			setSatelliteError(presenceKey, binding.satelliteId, "esphome", message)
			scheduler.schedule(safeOpen)
		})
	}

	safeOpen()

	return {
		close: () => {
			scheduler.close(() => client?.disconnect())
		},
	}
}

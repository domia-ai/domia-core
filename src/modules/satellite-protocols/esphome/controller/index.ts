import { type DomiaType } from "@/modules/core"
import {
	createSatelliteSession,
	createReconnectScheduler,
	type SatelliteTransportType,
} from "@/modules/satellite-core"
import {
	setPresenceStatus,
	setSatelliteConnecting,
	setSatelliteError,
	updateSatelliteMeta,
	registerSatelliteControl,
	unregisterSatelliteControl,
	onPresenceChange,
	type PresenceStatusType,
	type SatelliteWakeWordType,
	type SatelliteNumberEntityType,
} from "@/modules/core-bus"
import { DEFAULT_SATELLITE_RECONNECT_MS } from "@/db"
import { satelliteEsphomeLogger as logger } from "@/utils"

import type { Entity, NumberEvent } from "esphome-client"
import type {
	EsphomeModuleType,
	EsphomeBindingType,
	EsphomeSatelliteHandleType,
	NumberEntityInfoType,
} from "../types"

const isNumberEntity = (
	e: Entity & { id: string },
): e is NumberEntityInfoType => e.type === "number"

const loadEsphome = new Function("s", "return import(s)") as (
	s: string,
) => Promise<EsphomeModuleType>

let esphomeModule: EsphomeModuleType | null = null
const getEsphome = async (): Promise<EsphomeModuleType> =>
	(esphomeModule ??= await loadEsphome("esphome-client"))

export const connectEsphomeSatellite = (
	binding: EsphomeBindingType,
	fallback: DomiaType,
	domiaKey?: string,
	esphomeOverride?: EsphomeModuleType,
): EsphomeSatelliteHandleType => {
	const presenceKey = domiaKey ?? fallback.domiaKey
	const scheduler = createReconnectScheduler(DEFAULT_SATELLITE_RECONNECT_MS)
	let client: { disconnect: () => void } | null = null
	let unsubscribePresence: (() => void) | null = null
	let reconnectCount = 0
	let desiredWakeWords = binding.desiredWakeWords
		? [...binding.desiredWakeWords]
		: []
	const desiredNumbers: Record<string, number> = {
		...(binding.desiredNumbers ?? {}),
	}
	let followUpEnabled = binding.followUpEnabled ?? false
	let lastTranscriptChars = 0
	const shouldFollowUp = () => followUpEnabled && lastTranscriptChars > 0
	let numberEntities: SatelliteNumberEntityType[] = []
	let mediaPlayerId: string | null = null
	let desiredVolume = binding.desiredVolume ?? null
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

		const phaseForStatus: Record<PresenceStatusType, number> = {
			idle: VoiceAssistantEvent.RUN_END,
			listening: VoiceAssistantEvent.STT_START,
			thinking: VoiceAssistantEvent.INTENT_START,
			speaking: VoiceAssistantEvent.TTS_START,
		}

		const esp = new EspHomeClient({
			host: binding.host,
			port: binding.port,
			psk: binding.encryptionKey,
			clientId: "domia",
		})
		client = esp

		const event = (type: number, data?: { name: string; value: string }[]) =>
			esp.sendVoiceAssistantEvent(type, data)

		const transport: SatelliteTransportType = {
			sendReady: () => undefined,
			sendTranscript: (text) => {
				lastTranscriptChars = text.trim().length
				event(VoiceAssistantEvent.STT_END, [{ name: "text", value: text }])
			},
			sendReplyDone: () => undefined,
			sendError: (message) =>
				event(VoiceAssistantEvent.ERROR, [{ name: "message", value: message }]),
			beginAudio: () => undefined,
			writeAudio: () => undefined,
			endAudio: () => undefined,
			close: () => esp.disconnect(),
			serverEndpointing: true,
			notifySpeechEnd: () => event(VoiceAssistantEvent.STT_VAD_END),
			playAudioUrl: (url) =>
				shouldFollowUp()
					? esp.sendVoiceAssistantAnnounce({
							mediaId: url,
							startConversation: true,
						})
					: event(VoiceAssistantEvent.TTS_END, [{ name: "url", value: url }]),
			announce: (url) => esp.sendVoiceAssistantAnnounce({ mediaId: url }),
			pauseAudio: () => {
				if (!mediaPlayerId) return false
				esp.sendMediaPlayerCommand(mediaPlayerId, {
					command: MediaPlayerCommand.PAUSE,
				})
				return true
			},
			resumeAudio: () => {
				if (!mediaPlayerId) return false
				esp.sendMediaPlayerCommand(mediaPlayerId, {
					command: MediaPlayerCommand.PLAY,
				})
				return true
			},
			outputCapabilities: {
				pause: true,
				position: "sentence",
				urlPlayback: true,
				captions: false,
			},
			finishTurn: () => {
				// RUN_END cancels an in-flight startConversation re-arm; skip on follow-up
				if (!shouldFollowUp()) event(VoiceAssistantEvent.RUN_END)
			},
			followUp: true,
		}

		const session = createSatelliteSession({
			fallback,
			transport,
			protocol: "esphome",
		})

		unsubscribePresence?.()
		unsubscribePresence = onPresenceChange(presenceKey, (status) => {
			if (status === "idle") return
			event(phaseForStatus[status])
		})

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
				},
				announce: (url) => esp.sendVoiceAssistantAnnounce({ mediaId: url }),
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
					const clamped = Math.min(1, Math.max(0, volume))
					desiredVolume = clamped
					if (mediaPlayerId)
						esp.sendMediaPlayerCommand(mediaPlayerId, { volume: clamped })
					updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
						volume: clamped,
					})
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

		esp.on("entities", () => {
			const withIds = esp.getEntitiesWithIds()
			const mp = withIds.find((e) => e.type === "media_player")
			mediaPlayerId = mp?.id ?? null
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

		esp.on("telemetry", (evt: { type?: string; volume?: number }) => {
			if (evt.type !== "media_player" || typeof evt.volume !== "number") return
			updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
				volume: evt.volume,
			})
		})

		esp.on("voiceAssistantAnnounceFinished", () => {
			updateSatelliteMeta(presenceKey, binding.satelliteId, "esphome", {
				lastPlaybackAt: Date.now(),
			})
		})

		esp.on("voiceAssistantRequest", (req: { start?: boolean }) => {
			if (req.start) {
				lastTranscriptChars = 0
				if (mediaPlayerId)
					esp.sendMediaPlayerCommand(mediaPlayerId, {
						command: MediaPlayerCommand.STOP,
					})
				esp.sendVoiceAssistantResponse(0, false)
				event(VoiceAssistantEvent.RUN_START)
				setPresenceStatus(presenceKey, "listening")
			} else {
				lastTranscriptChars = 0
				session.onCancel()
				setPresenceStatus(presenceKey, "idle", true)
				event(VoiceAssistantEvent.RUN_END)
			}
		})

		esp.on("voiceAssistantAudio", (audio: { data: Buffer; end: boolean }) => {
			if (audio.data?.length) session.onAudio(audio.data)
			if (audio.end) void session.onSpeechEnd()
		})

		esp.on("disconnect", (reason?: string) => {
			lastTranscriptChars = 0
			session.onClose()
			unregisterSatelliteControl(presenceKey, binding.satelliteId)
			unsubscribePresence?.()
			unsubscribePresence = null
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
		open().catch((err) => {
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
			unsubscribePresence?.()
			unsubscribePresence = null
			scheduler.close(() => client?.disconnect())
		},
	}
}

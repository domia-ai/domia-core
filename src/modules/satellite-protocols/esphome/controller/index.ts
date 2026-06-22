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
	onPresenceChange,
	type PresenceStatusType,
} from "@/modules/core-bus"
import { DEFAULT_SATELLITE_RECONNECT_MS } from "@/db"
import { satelliteEsphomeLogger as logger } from "@/utils"

import type {
	EsphomeModuleType,
	EsphomeBindingType,
	EsphomeSatelliteHandleType,
} from "../types"

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

	const open = async (): Promise<void> => {
		if (scheduler.isClosed()) return
		const { EspHomeClient, VoiceAssistantSubscribeFlag, VoiceAssistantEvent } =
			esphomeOverride ?? (await getEsphome())
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
			sendTranscript: (text) =>
				event(VoiceAssistantEvent.STT_END, [{ name: "text", value: text }]),
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
				event(VoiceAssistantEvent.TTS_END, [{ name: "url", value: url }]),
			finishTurn: () => event(VoiceAssistantEvent.RUN_END),
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
			esp.subscribeVoiceAssistant(VoiceAssistantSubscribeFlag.API_AUDIO)
			logger.info("🛰️ connected to esphome satellite", {
				host: binding.host,
				satelliteId: binding.satelliteId,
				domiaKey,
			})
			void session.onHello({ domiaKey, satelliteId: binding.satelliteId })
		})

		esp.on("voiceAssistantRequest", (req: { start?: boolean }) => {
			if (req.start) {
				esp.sendVoiceAssistantResponse(0, false)
				event(VoiceAssistantEvent.RUN_START)
				setPresenceStatus(presenceKey, "listening")
			} else {
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
			session.onClose()
			unsubscribePresence?.()
			unsubscribePresence = null
			client = null
			if (!scheduler.isClosed()) {
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

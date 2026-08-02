import { WebSocketServer, type WebSocket, type RawData } from "ws"

import { type DomiaType } from "@/modules/core"
import {
	satelliteGatewayLogger,
	isLoopbackAddress,
	isValidMeshToken,
} from "@/utils"
import {
	createSatelliteSession,
	type SatelliteTransportType,
} from "@/modules/satellite-core"

import type {
	SatelliteControlType,
	SatelliteDownMessageType,
	SatelliteGatewayHandleType,
} from "../types"

const WS_HEARTBEAT_MS = 30_000
const WS_MAX_BUFFERED_BYTES = 4 * 1024 * 1024

const send = (ws: WebSocket, message: SatelliteDownMessageType): void => {
	if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

export const startWsHeartbeat = (wss: WebSocketServer): void => {
	const alive = new WeakSet<WebSocket>()
	wss.on("connection", (ws: WebSocket) => {
		alive.add(ws)
		ws.on("pong", () => alive.add(ws))
	})
	const interval = setInterval(() => {
		for (const ws of wss.clients) {
			if (!alive.has(ws)) {
				satelliteGatewayLogger.warn("ws client unresponsive — terminating")
				ws.terminate()
				continue
			}
			alive.delete(ws)
			ws.ping()
		}
	}, WS_HEARTBEAT_MS)
	wss.on("close", () => clearInterval(interval))
}

const parseControl = (data: RawData): SatelliteControlType | null => {
	try {
		const parsed = JSON.parse(data.toString())
		return typeof parsed?.type === "string"
			? (parsed as SatelliteControlType)
			: null
	} catch {
		return null
	}
}

const wsTransport = (
	ws: WebSocket,
	serverEndpointing: boolean,
): SatelliteTransportType => {
	let backpressureWarnedAt = 0
	return {
		sendReady: (domiaKey, name) => send(ws, { type: "ready", domiaKey, name }),
		sendTranscript: (text) => send(ws, { type: "transcript", text }),
		sendReplyDone: (reply, interactionId) =>
			send(ws, { type: "reply_done", reply, interactionId }),
		sendError: (message) => send(ws, { type: "error", message }),
		beginAudio: (format, interactionId) =>
			send(ws, {
				type: "audio_stream_begin",
				sampleRate: format.sampleRate,
				channels: format.channels,
				...(interactionId ? { interactionId } : {}),
			}),
		writeAudio: (chunk) => {
			if (ws.readyState !== ws.OPEN) return
			if (ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
				if (Date.now() - backpressureWarnedAt > 5000) {
					backpressureWarnedAt = Date.now()
					satelliteGatewayLogger.warn(
						"ws backpressure — dropping audio frames for slow client",
					)
				}
				return
			}
			ws.send(chunk)
		},
		endAudio: () => send(ws, { type: "audio_stream_end" }),
		close: () => ws.close(),
		serverEndpointing,
		notifySpeechEnd: () => send(ws, { type: "speech_stopped" }),
		pauseAudio: () => {
			if (ws.readyState !== ws.OPEN) return false
			send(ws, { type: "audio_pause" })
			return true
		},
		resumeAudio: () => {
			if (ws.readyState !== ws.OPEN) return false
			send(ws, { type: "audio_resume" })
			return true
		},
		outputCapabilities: {
			pause: true,
			position: "estimated",
			urlPlayback: false,
			captions: true,
		},
	}
}

const isLiveRequest = (url: string | undefined): boolean =>
	new URL(url ?? "/", "http://satellite").searchParams.get("live") === "1"

export const setupSatelliteGateway = (
	fallback: DomiaType,
): SatelliteGatewayHandleType => {
	const wss = new WebSocketServer({ noServer: true })
	startWsHeartbeat(wss)

	wss.on("connection", (ws, request) => {
		const remoteLoopback = isLoopbackAddress(request.socket.remoteAddress)
		const session = createSatelliteSession({
			fallback,
			transport: wsTransport(ws, isLiveRequest(request.url)),
			protocol: "native",
		})

		ws.on("message", (data, isBinary) => {
			if (isBinary) {
				session.onAudio(Buffer.from(data as Buffer))
				return
			}
			const control = parseControl(data)
			if (!control) return
			void (async () => {
				if (control.type === "hello") {
					if (!remoteLoopback && !isValidMeshToken(control.token)) {
						satelliteGatewayLogger.warn(
							"satellite rejected — invalid mesh token",
							{ satelliteId: control.satelliteId },
						)
						ws.send(JSON.stringify({ type: "error", message: "unauthorized" }))
						ws.close()
						return
					}
					await session.onHello({
						domiaKey: control.domiaKey,
						satelliteId: control.satelliteId,
						sampleRate: control.sampleRate,
						channels: control.channels,
					})
				} else if (control.type === "speech_end") {
					await session.onSpeechEnd()
				} else if (control.type === "audio_played") {
					session.onAudioPlayed(control.interactionId)
				} else if (control.type === "cancel") {
					session.onCancel()
				}
			})()
		})

		ws.on("close", () => session.onClose())

		ws.on("error", (err) => {
			satelliteGatewayLogger.warn("satellite socket error", { err })
		})
	})

	satelliteGatewayLogger.success("🛰️ Satellite gateway ready on /satellite")

	return { close: () => wss.close(), server: wss }
}

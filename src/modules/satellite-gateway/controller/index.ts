import { WebSocketServer, type WebSocket, type RawData } from "ws"
import type { Server } from "http"

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

const send = (ws: WebSocket, message: SatelliteDownMessageType): void => {
	if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
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
): SatelliteTransportType => ({
	sendReady: (domiaKey, name) => send(ws, { type: "ready", domiaKey, name }),
	sendTranscript: (text) => send(ws, { type: "transcript", text }),
	sendReplyDone: (reply, interactionId) =>
		send(ws, { type: "reply_done", reply, interactionId }),
	sendError: (message) => send(ws, { type: "error", message }),
	beginAudio: (format) =>
		send(ws, {
			type: "audio_stream_begin",
			sampleRate: format.sampleRate,
			channels: format.channels,
		}),
	writeAudio: (chunk) => {
		if (ws.readyState === ws.OPEN) ws.send(chunk)
	},
	endAudio: () => send(ws, { type: "audio_stream_end" }),
	close: () => ws.close(),
	serverEndpointing,
	notifySpeechEnd: () => send(ws, { type: "speech_end" }),
})

const isLiveRequest = (url: string | undefined): boolean =>
	new URL(url ?? "/", "http://satellite").searchParams.get("live") === "1"

export const setupSatelliteGateway = (
	server: Server,
	fallback: DomiaType,
): SatelliteGatewayHandleType => {
	const wss = new WebSocketServer({ server, path: "/satellite" })

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

import { WebSocketServer, type WebSocket, type RawData } from "ws"
import type { IncomingMessage } from "http"

import { type DomiaType, isHostedIdentity } from "@/modules/core"
import {
	realtimeGatewayLogger,
	isLoopbackAddress,
	isValidMeshToken,
	isValidMeshBearer,
	downsamplePcm16,
	downmixToMonoPcm16,
	generateUuid,
} from "@/utils"
import {
	createSatelliteSession,
	type SatelliteSessionType,
	type SatelliteTransportType,
} from "@/modules/satellite-core"
import { startWsHeartbeat } from "@/modules/satellite-gateway"

import type {
	RealtimeClientEventType,
	RealtimeGatewayHandleType,
	RealtimeServerEventType,
} from "../types"

const STT_INPUT_RATE = 16000
const DEFAULT_INPUT_RATE = 24000
const INSECURE_KEY_SUBPROTOCOL = "openai-insecure-api-key."
const WS_MAX_BUFFERED_BYTES = 4 * 1024 * 1024

const parseEvent = (data: RawData): RealtimeClientEventType | null => {
	try {
		const parsed = JSON.parse(data.toString())
		return typeof parsed?.type === "string"
			? (parsed as RealtimeClientEventType)
			: null
	} catch {
		return null
	}
}

const subprotocolToken = (request: IncomingMessage): string | undefined => {
	const header = request.headers["sec-websocket-protocol"]
	if (!header) return undefined
	return header
		.split(",")
		.map((p) => p.trim())
		.find((p) => p.startsWith(INSECURE_KEY_SUBPROTOCOL))
		?.slice(INSECURE_KEY_SUBPROTOCOL.length)
}

const isAuthorized = (request: IncomingMessage): boolean =>
	isLoopbackAddress(request.socket.remoteAddress) ||
	isValidMeshBearer(request.headers.authorization) ||
	isValidMeshToken(subprotocolToken(request))

const requestedDomiaKey = (url: string | undefined): string | undefined => {
	const params = new URL(url ?? "/", "http://realtime").searchParams
	const raw = params.get("model") ?? params.get("domiaKey") ?? undefined
	if (!raw) return undefined
	return raw.startsWith("domia/") ? raw.slice("domia/".length) : raw
}

export const setupRealtimeGateway = (
	fallback: DomiaType,
): RealtimeGatewayHandleType => {
	const wss = new WebSocketServer({
		noServer: true,
		handleProtocols: (protocols) =>
			protocols.has("realtime")
				? "realtime"
				: (protocols.values().next().value ?? false),
	})
	startWsHeartbeat(wss)

	wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
		let eventSeq = 0
		const send = (event: Omit<RealtimeServerEventType, "event_id">): void => {
			if (ws.readyState !== ws.OPEN) return
			eventSeq += 1
			ws.send(JSON.stringify({ event_id: `event_${eventSeq}`, ...event }))
		}
		const sendError = (code: string, message: string): void =>
			send({ type: "error", error: { type: code, message } })

		if (!isAuthorized(request)) {
			realtimeGatewayLogger.warn("realtime client rejected — unauthorized")
			sendError("invalid_request_error", "unauthorized")
			ws.close()
			return
		}

		const domiaKey = requestedDomiaKey(request.url)
		if (domiaKey && !isHostedIdentity(domiaKey)) {
			sendError("invalid_request_error", `unknown model: ${domiaKey}`)
			ws.close()
			return
		}

		const satelliteId = `realtime-${generateUuid().slice(0, 8)}`
		let serverEndpointing = true
		let inputRate = DEFAULT_INPUT_RATE
		let inputChannels = 1
		let itemSeq = 0
		let responseId: string | null = null
		let session: SatelliteSessionType | null = null
		let sessionInit: Promise<SatelliteSessionType> | null = null

		const makeTransport = (): SatelliteTransportType => ({
			sendReady: () => undefined,
			sendTranscript: (text) =>
				send({
					type: "conversation.item.input_audio_transcription.completed",
					item_id: `item_${itemSeq}`,
					transcript: text,
				}),
			sendReplyDone: (reply, interactionId) => {
				send({
					type: "response.output_audio_transcript.done",
					response_id: responseId,
					transcript: reply,
				})
				send({
					type: "response.done",
					response: {
						id: responseId,
						status: "completed",
						metadata: { interaction_id: interactionId },
					},
				})
				responseId = null
			},
			sendError: (message) => sendError("server_error", message),
			beginAudio: (format) => {
				responseId = `resp_${generateUuid().slice(0, 8)}`
				send({
					type: "response.created",
					response: { id: responseId, status: "in_progress" },
				})
				send({
					type: "response.output_audio_format",
					response_id: responseId,
					sample_rate: format.sampleRate,
					channels: format.channels,
				})
			},
			writeAudio: (chunk) => {
				if (ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) return
				send({
					type: "response.output_audio.delta",
					response_id: responseId,
					delta: chunk.toString("base64"),
				})
			},
			endAudio: () =>
				send({ type: "response.output_audio.done", response_id: responseId }),
			close: () => ws.close(),
			serverEndpointing,
			notifySpeechEnd: () => {
				itemSeq += 1
				send({
					type: "input_audio_buffer.speech_stopped",
					item_id: `item_${itemSeq}`,
				})
			},
			outputCapabilities: {
				pause: false,
				position: "none",
				urlPlayback: false,
				captions: true,
			},
		})

		const ensureSession = (): Promise<SatelliteSessionType> => {
			if (!sessionInit) {
				const created = createSatelliteSession({
					fallback,
					transport: makeTransport(),
					protocol: "openai-realtime",
				})
				session = created
				sessionInit = created
					.onHello({
						domiaKey,
						satelliteId,
						sampleRate: STT_INPUT_RATE,
						channels: 1,
					})
					.then(() => created)
			}
			return sessionInit
		}

		const handleEvent = async (
			event: RealtimeClientEventType,
		): Promise<void> => {
			if (event.type === "session.update") {
				if (event.session && "turn_detection" in event.session) {
					const wanted = event.session.turn_detection !== null
					if (session && wanted !== serverEndpointing) {
						realtimeGatewayLogger.warn(
							"turn_detection change ignored — session already started",
							{ satelliteId },
						)
					} else {
						serverEndpointing = wanted
					}
				}
				const format = event.session?.audio?.input?.format
				if (format?.rate && !session) inputRate = format.rate
				if (format?.channels && !session) inputChannels = format.channels
				send({
					type: "session.updated",
					session: {
						turn_detection: serverEndpointing ? { type: "server_vad" } : null,
					},
				})
				return
			}
			if (event.type === "input_audio_buffer.append") {
				if (typeof event.audio !== "string") return
				const active = await ensureSession()
				const pcm = downmixToMonoPcm16(
					Buffer.from(event.audio, "base64"),
					inputChannels,
				)
				active.onAudio(downsamplePcm16(pcm, inputRate, STT_INPUT_RATE))
				return
			}
			if (event.type === "input_audio_buffer.commit") {
				const active = await ensureSession()
				itemSeq += 1
				send({
					type: "input_audio_buffer.committed",
					item_id: `item_${itemSeq}`,
				})
				await active.onSpeechEnd()
				return
			}
			if (event.type === "input_audio_buffer.clear") {
				session?.onCancel()
				send({ type: "input_audio_buffer.cleared" })
				return
			}
			if (event.type === "response.cancel") {
				session?.onCancel()
				return
			}
			if (event.type === "response.create") {
				if (session) await session.onSpeechEnd()
				return
			}
			sendError(
				"invalid_request_error",
				`unsupported event: ${(event as { type: string }).type}`,
			)
		}

		ws.on("message", (data, isBinary) => {
			if (isBinary) return
			const event = parseEvent(data)
			if (!event) {
				sendError("invalid_request_error", "invalid JSON event")
				return
			}
			void handleEvent(event).catch((err) => {
				realtimeGatewayLogger.warn("realtime event failed", {
					satelliteId,
					err,
				})
			})
		})

		ws.on("close", () => session?.onClose())
		ws.on("error", (err) => {
			realtimeGatewayLogger.warn("realtime socket error", { err })
		})

		send({
			type: "session.created",
			session: {
				object: "realtime.session",
				model: domiaKey ?? fallback.domiaKey,
				input_audio_format: "pcm16",
				output_audio_format: "pcm16",
				turn_detection: { type: "server_vad" },
			},
		})
	})

	realtimeGatewayLogger.success("🛰️ Realtime gateway ready on /v1/realtime")

	return { close: () => wss.close(), server: wss }
}

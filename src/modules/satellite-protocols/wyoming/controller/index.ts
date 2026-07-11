import { connect, type Socket } from "net"

import { type DomiaType } from "@/modules/core"
import {
	createSatelliteSession,
	createReconnectScheduler,
	type SatelliteTransportType,
} from "@/modules/satellite-core"
import { setSatelliteConnecting, setSatelliteError } from "@/modules/core-bus"
import { satelliteWyomingLogger } from "@/utils"

import type {
	WyomingConnectionType,
	WyomingEventHandlerType,
	WyomingSatelliteHandleType,
} from "../types"

const WYOMING_VERSION = "1.6.0"
const RECONNECT_MS = 3000
const PING_INTERVAL_MS = 30_000
const LIVENESS_TIMEOUT_MS = 120_000
const MAX_HEADER_BYTES = 64 * 1024
const MAX_EVENT_BYTES = 10 * 1024 * 1024

export const createWyomingConnection = (
	socket: Socket,
	onEvent: WyomingEventHandlerType,
): WyomingConnectionType => {
	let buf = Buffer.alloc(0)

	const fail = (reason: string): void => {
		satelliteWyomingLogger.warn("wyoming framing error — closing", { reason })
		buf = Buffer.alloc(0)
		socket.destroy()
	}

	const drain = (): void => {
		for (;;) {
			const nl = buf.indexOf(0x0a)
			if (nl < 0) {
				if (buf.length > MAX_HEADER_BYTES) fail("header too long")
				return
			}
			let header: Record<string, unknown>
			try {
				header = JSON.parse(buf.subarray(0, nl).toString("utf8"))
			} catch {
				buf = buf.subarray(nl + 1)
				continue
			}
			const dataLen = Number(header.data_length ?? 0)
			const payloadLen = Number(header.payload_length ?? 0)
			if (
				!Number.isFinite(dataLen) ||
				!Number.isFinite(payloadLen) ||
				dataLen < 0 ||
				payloadLen < 0 ||
				dataLen + payloadLen > MAX_EVENT_BYTES
			) {
				fail("invalid event length")
				return
			}
			const end = nl + 1 + dataLen + payloadLen
			if (buf.length < end) return
			let data: Record<string, unknown> =
				typeof header.data === "object" && header.data
					? (header.data as Record<string, unknown>)
					: {}
			if (dataLen > 0) {
				try {
					data = {
						...data,
						...JSON.parse(
							buf.subarray(nl + 1, nl + 1 + dataLen).toString("utf8"),
						),
					}
				} catch {
					/* empty */
				}
			}
			const payload =
				payloadLen > 0 ? Buffer.from(buf.subarray(nl + 1 + dataLen, end)) : null
			buf = buf.subarray(end)
			onEvent(String(header.type), data, payload)
		}
	}

	socket.on("data", (chunk: Buffer) => {
		buf = Buffer.concat([buf, chunk])
		drain()
	})

	return {
		write: (type, data, payload) => {
			const header: Record<string, unknown> = { type, version: WYOMING_VERSION }
			let dataBytes: Buffer | null = null
			if (data && Object.keys(data).length > 0) {
				dataBytes = Buffer.from(JSON.stringify(data), "utf8")
				header.data_length = dataBytes.length
			}
			if (payload && payload.length > 0) header.payload_length = payload.length
			socket.write(JSON.stringify(header) + "\n")
			if (dataBytes) socket.write(dataBytes)
			if (payload && payload.length > 0) socket.write(payload)
		},
	}
}

const parseAddress = (address: string): { host: string; port: number } => {
	const idx = address.lastIndexOf(":")
	return { host: address.slice(0, idx), port: Number(address.slice(idx + 1)) }
}

export const connectWyomingSatellite = (
	address: string,
	fallback: DomiaType,
	domiaKey?: string,
	satelliteId?: string,
): WyomingSatelliteHandleType => {
	const presenceKey = domiaKey ?? fallback.domiaKey
	const sid = satelliteId ?? address
	const scheduler = createReconnectScheduler(RECONNECT_MS)
	let socket: Socket | null = null

	const open = (): void => {
		if (scheduler.isClosed()) return
		const { host, port } = parseAddress(address)
		setSatelliteConnecting(presenceKey, sid, "wyoming")
		const sock = connect({ host, port })
		socket = sock
		let outFormat = { sampleRate: 24000, channels: 1 as 1 | 2 }

		const transport: SatelliteTransportType = {
			sendReady: () => undefined,
			sendTranscript: (text) => conn.write("transcript", { text }),
			sendReplyDone: () => undefined,
			sendError: (message) =>
				satelliteWyomingLogger.warn("turn error", { address, message }),
			beginAudio: (format) => {
				outFormat = { sampleRate: format.sampleRate, channels: format.channels }
				conn.write("audio-start", {
					rate: format.sampleRate,
					width: 2,
					channels: format.channels,
				})
			},
			writeAudio: (chunk) =>
				conn.write(
					"audio-chunk",
					{
						rate: outFormat.sampleRate,
						width: 2,
						channels: outFormat.channels,
					},
					chunk,
				),
			endAudio: () => conn.write("audio-stop", {}),
			close: () => sock.end(),
			outputCapabilities: {
				pause: false,
				position: "sentence",
				urlPlayback: false,
				captions: false,
			},
		}

		const session = createSatelliteSession({
			fallback,
			transport,
			protocol: "wyoming",
		})

		let lastEventAt = Date.now()
		const conn = createWyomingConnection(sock, (type, data, payload) => {
			lastEventAt = Date.now()
			if (type === "audio-start") {
				session.setFormat(
					Number(data.rate ?? 16000),
					Number(data.channels ?? 1),
				)
			} else if (type === "audio-chunk") {
				if (payload) session.onAudio(payload)
			} else if (type === "audio-stop") {
				void session.onSpeechEnd()
			} else if (type === "ping") {
				conn.write(
					"pong",
					typeof data.text === "string" ? { text: data.text } : undefined,
				)
			}
		})

		const liveness = setInterval(() => {
			if (Date.now() - lastEventAt > LIVENESS_TIMEOUT_MS) {
				satelliteWyomingLogger.warn(
					"wyoming satellite unresponsive — reconnecting",
					{ address },
				)
				sock.destroy()
				return
			}
			conn.write("ping", {})
		}, PING_INTERVAL_MS)

		sock.on("connect", () => {
			scheduler.reset()
			lastEventAt = Date.now()
			sock.setKeepAlive(true, PING_INTERVAL_MS)
			satelliteWyomingLogger.info("🛰️ connected to wyoming satellite", {
				address,
				domiaKey,
			})
			void session.onHello({ domiaKey, satelliteId: sid })
			conn.write("run-satellite", {})
		})
		sock.on("close", () => {
			clearInterval(liveness)
			session.onClose()
			socket = null
			if (!scheduler.isClosed()) scheduler.schedule(open)
		})
		sock.on("error", (err) => {
			setSatelliteError(presenceKey, sid, "wyoming", err.message)
			satelliteWyomingLogger.warn("wyoming socket error", {
				address,
				err: err.message,
			})
		})
	}

	open()

	return {
		close: () => scheduler.close(() => socket?.end()),
	}
}

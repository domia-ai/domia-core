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
	WyomingEventHandlerType,
	WyomingSatelliteHandleType,
} from "../types"

const WYOMING_VERSION = "1.6.0"
const RECONNECT_MS = 3000
const MAX_HEADER_BYTES = 64 * 1024
const MAX_EVENT_BYTES = 10 * 1024 * 1024

class WyomingConnection {
	private buf = Buffer.alloc(0)

	constructor(
		private readonly socket: Socket,
		private readonly onEvent: WyomingEventHandlerType,
	) {
		socket.on("data", (chunk: Buffer) => {
			this.buf = Buffer.concat([this.buf, chunk])
			this.drain()
		})
	}

	private fail(reason: string): void {
		satelliteWyomingLogger.warn("wyoming framing error — closing", { reason })
		this.buf = Buffer.alloc(0)
		this.socket.destroy()
	}

	private drain(): void {
		for (;;) {
			const nl = this.buf.indexOf(0x0a)
			if (nl < 0) {
				if (this.buf.length > MAX_HEADER_BYTES) this.fail("header too long")
				return
			}
			let header: Record<string, unknown>
			try {
				header = JSON.parse(this.buf.subarray(0, nl).toString("utf8"))
			} catch {
				this.buf = this.buf.subarray(nl + 1)
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
				this.fail("invalid event length")
				return
			}
			const end = nl + 1 + dataLen + payloadLen
			if (this.buf.length < end) return
			let data: Record<string, unknown> =
				typeof header.data === "object" && header.data
					? (header.data as Record<string, unknown>)
					: {}
			if (dataLen > 0) {
				try {
					data = {
						...data,
						...JSON.parse(
							this.buf.subarray(nl + 1, nl + 1 + dataLen).toString("utf8"),
						),
					}
				} catch {
					/* keep header data */
				}
			}
			const payload =
				payloadLen > 0
					? Buffer.from(this.buf.subarray(nl + 1 + dataLen, end))
					: null
			this.buf = this.buf.subarray(end)
			this.onEvent(String(header.type), data, payload)
		}
	}

	write(type: string, data?: Record<string, unknown>, payload?: Buffer): void {
		const header: Record<string, unknown> = { type, version: WYOMING_VERSION }
		let dataBytes: Buffer | null = null
		if (data && Object.keys(data).length > 0) {
			dataBytes = Buffer.from(JSON.stringify(data), "utf8")
			header.data_length = dataBytes.length
		}
		if (payload && payload.length > 0) header.payload_length = payload.length
		this.socket.write(JSON.stringify(header) + "\n")
		if (dataBytes) this.socket.write(dataBytes)
		if (payload && payload.length > 0) this.socket.write(payload)
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
		}

		const session = createSatelliteSession({
			fallback,
			transport,
			protocol: "wyoming",
		})

		const conn = new WyomingConnection(sock, (type, data, payload) => {
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

		sock.on("connect", () => {
			satelliteWyomingLogger.info("🛰️ connected to wyoming satellite", {
				address,
				domiaKey,
			})
			void session.onHello({ domiaKey, satelliteId: sid })
			conn.write("run-satellite", {})
		})
		sock.on("close", () => {
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

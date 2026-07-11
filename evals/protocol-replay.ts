import { EventEmitter } from "events"
import type { Socket } from "net"

import { createWyomingConnection } from "@/modules/satellite-protocols/wyoming"

import { makeChecker } from "./lib"
import type { ReplayEventType, ReplaySocketType } from "./types"

const checker = makeChecker()
const { check } = checker

const makeReplaySocket = (): ReplaySocketType => {
	const emitter = new EventEmitter()
	const written: Buffer[] = []
	let destroyed = false
	const socket = emitter as unknown as Socket
	socket.write = ((chunk: string | Buffer) => {
		written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
		return true
	}) as Socket["write"]
	socket.destroy = (() => {
		destroyed = true
		return socket
	}) as Socket["destroy"]
	return {
		socket,
		feed: (chunk) => emitter.emit("data", chunk),
		written: () => Buffer.concat(written),
		isDestroyed: () => destroyed,
	}
}

const frame = (
	type: string,
	data?: Record<string, unknown>,
	payload?: Buffer,
): Buffer => {
	const dataBytes = data ? Buffer.from(JSON.stringify(data), "utf8") : null
	const header: Record<string, unknown> = { type, version: "1.6.0" }
	if (dataBytes) header.data_length = dataBytes.length
	if (payload?.length) header.payload_length = payload.length
	return Buffer.concat([
		Buffer.from(JSON.stringify(header) + "\n", "utf8"),
		dataBytes ?? Buffer.alloc(0),
		payload ?? Buffer.alloc(0),
	])
}

const collect = (): { events: ReplayEventType[]; sock: ReplaySocketType } => {
	const sock = makeReplaySocket()
	const events: ReplayEventType[] = []
	createWyomingConnection(sock.socket, (type, data, payload) =>
		events.push({ type, data, payloadBytes: payload?.length ?? 0 }),
	)
	return { events, sock }
}

const main = (): void => {
	console.log("[1] wyoming round-trip: whole frames")
	{
		const { events, sock } = collect()
		const pcm = Buffer.alloc(3200, 7)
		sock.feed(frame("run-satellite"))
		sock.feed(frame("audio-start", { rate: 16000, width: 2, channels: 1 }))
		sock.feed(frame("audio-chunk", { rate: 16000 }, pcm))
		sock.feed(frame("audio-stop"))
		check("4 events parsed", events.length === 4, String(events.length))
		check(
			"types in order",
			events.map((e) => e.type).join(",") ===
				"run-satellite,audio-start,audio-chunk,audio-stop",
		)
		check("data merged", events[1]?.data.rate === 16000)
		check("payload intact", events[2]?.payloadBytes === 3200)
		check("no destroy", !sock.isDestroyed())
	}

	console.log("[2] wyoming replay: frames split at awkward byte boundaries")
	{
		const { events, sock } = collect()
		const pcm = Buffer.alloc(1601, 3)
		const stream = Buffer.concat([
			frame("audio-start", { rate: 22050, width: 2, channels: 2 }),
			frame("audio-chunk", { rate: 22050 }, pcm),
			frame("audio-stop"),
		])
		for (let i = 0; i < stream.length; i += 7) {
			sock.feed(stream.subarray(i, Math.min(i + 7, stream.length)))
		}
		check(
			"3 events from 7-byte chunks",
			events.length === 3,
			String(events.length),
		)
		check("odd payload intact", events[1]?.payloadBytes === 1601)
		check("channels preserved", events[0]?.data.channels === 2)
	}

	console.log("[3] wyoming replay: split inside the JSON header")
	{
		const { events, sock } = collect()
		const one = frame("ping", { text: "abc" })
		sock.feed(one.subarray(0, 5))
		sock.feed(one.subarray(5, 12))
		sock.feed(one.subarray(12))
		check(
			"header reassembled",
			events.length === 1 && events[0].type === "ping",
		)
		check("data survives split", events[0]?.data.text === "abc")
	}

	console.log("[4] wyoming replay: garbage line skipped, stream recovers")
	{
		const { events, sock } = collect()
		sock.feed(Buffer.from("not-json-at-all\n", "utf8"))
		sock.feed(frame("pong"))
		check("garbage skipped", events.length === 1 && events[0].type === "pong")
		check("no destroy on garbage", !sock.isDestroyed())
	}

	console.log("[5] wyoming replay: invalid lengths destroy the socket")
	{
		const { events, sock } = collect()
		sock.feed(
			Buffer.from(
				JSON.stringify({ type: "audio-chunk", payload_length: -5 }) + "\n",
			),
		)
		check("negative length destroys", sock.isDestroyed())
		check("no event emitted", events.length === 0)
	}
	{
		const { sock } = collect()
		sock.feed(
			Buffer.from(
				JSON.stringify({
					type: "audio-chunk",
					payload_length: 50 * 1024 * 1024,
				}) + "\n",
			),
		)
		check("oversized event destroys", sock.isDestroyed())
	}

	console.log("[6] wyoming replay: oversized headless buffer destroys")
	{
		const { sock } = collect()
		sock.feed(Buffer.alloc(70 * 1024, 65))
		check("70KB without newline destroys", sock.isDestroyed())
	}

	console.log(
		"[7] wyoming write side: emitted frames re-parse (codec round-trip)",
	)
	{
		const sock = makeReplaySocket()
		const conn = createWyomingConnection(sock.socket, () => undefined)
		conn.write("transcript", { text: "hello there" })
		conn.write("audio-chunk", { rate: 24000 }, Buffer.alloc(480, 1))
		const { events, sock: reparse } = collect()
		reparse.feed(sock.written())
		check(
			"2 written frames re-parse",
			events.length === 2,
			String(events.length),
		)
		check("text round-trips", events[0]?.data.text === "hello there")
		check("payload round-trips", events[1]?.payloadBytes === 480)
	}

	console.log(
		`\n${checker.passCount()}/${checker.passCount() + checker.failCount()} protocol-replay checks passed`,
	)
	process.exit(checker.failCount() === 0 ? 0 : 1)
}

main()

import { createServer as createTcpServer } from "node:net"

import { WebSocketServer, type WebSocket } from "ws"

import { createNemoSpeechSession } from "@/modules/stt-engine/engines/nemo-speech/session"
import type { DomiaType } from "@/modules/core"

import { makeChecker } from "./lib"

const checker = makeChecker()

const DELTA = "conversation.item.input_audio_transcription.delta"
const COMPLETED = "conversation.item.input_audio_transcription.completed"
const COMMITTED = "input_audio_buffer.committed"

type ServerScriptType = (socket: WebSocket, message: unknown) => void

type FakeServerType = {
	port: number
	close: () => Promise<void>
	sockets: WebSocket[]
}

const startServer = (onMessage: ServerScriptType): Promise<FakeServerType> =>
	new Promise((resolve) => {
		const wss = new WebSocketServer({ port: 0, path: "/realtime" })
		const sockets: WebSocket[] = []
		wss.on("connection", (socket) => {
			sockets.push(socket)
			socket.on("message", (data, isBinary) => {
				const parsed = isBinary
					? { binary: true, size: (data as Buffer).length }
					: JSON.parse(String(data))
				onMessage(socket, parsed)
			})
		})
		wss.on("listening", () => {
			const address = wss.address()
			const port = typeof address === "object" && address ? address.port : 0
			resolve({
				port,
				sockets,
				close: () =>
					new Promise((done) => {
						for (const s of sockets) s.terminate()
						wss.close(() => done())
					}),
			})
		})
	})

const domiaFor = (port: number): DomiaType =>
	({
		id: "nemo-suite",
		sttConfig: {
			baseUrl: `http://127.0.0.1:${port}`,
			apiKey: null,
			language: "en",
			timeoutMs: 700,
			modelName: null,
		},
	}) as unknown as DomiaType

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

const send = (socket: WebSocket, payload: Record<string, unknown>): void =>
	socket.send(JSON.stringify(payload))

const pcm = Buffer.alloc(640)

const happyPath = async (): Promise<void> => {
	const server = await startServer((socket, message) => {
		const m = message as { type?: string; binary?: boolean }
		if (m.binary) {
			send(socket, { type: DELTA, item_id: "a1", delta: "hello " })
			send(socket, { type: DELTA, item_id: "a1", delta: "world" })
		}
		if (m.type === "input_audio_buffer.commit") {
			send(socket, { type: COMMITTED, item_id: "a1" })
			send(socket, {
				type: COMPLETED,
				item_id: "a1",
				transcript: "hello world.",
			})
		}
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(150)
	const partial = session.partial()
	const final = await session.finish()
	checker.check(
		"happy path: partial accumulates deltas",
		partial === "hello world",
		partial,
	)
	checker.check(
		"happy path: finish returns the committed transcript",
		final === "hello world.",
		final,
	)
	await server.close()
}

const handshakeFail = async (): Promise<void> => {
	const session = createNemoSpeechSession(domiaFor(1))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(200)
	const outcome = await session.finish().then(
		() => "resolved",
		() => "rejected",
	)
	checker.check(
		"handshake failure: finish rejects instead of returning empty success",
		outcome === "rejected",
		outcome,
	)
}

const errorMidUtterance = async (): Promise<void> => {
	const server = await startServer((socket, message) => {
		const m = message as { type?: string; binary?: boolean }
		if (m.type === "input_audio_buffer.commit")
			send(socket, { type: "error", error: "engine exploded" })
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(150)
	const started = Date.now()
	const outcome = await session.finish().then(
		() => "resolved",
		() => "rejected",
	)
	const elapsed = Date.now() - started
	checker.check(
		"mid-utterance error with no text: finish rejects",
		outcome === "rejected",
		outcome,
	)
	checker.check(
		"mid-utterance error fails fast (no full timeout wait)",
		elapsed < 600,
		`${elapsed}ms`,
	)
	await server.close()
}

const closeWithPartial = async (): Promise<void> => {
	const server = await startServer((socket, message) => {
		const m = message as { binary?: boolean; type?: string }
		if (m.binary) {
			send(socket, { type: DELTA, item_id: "c1", delta: "turn on the lamp" })
			setTimeout(() => socket.terminate(), 80)
		}
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(250)
	const final = await session.finish()
	checker.check(
		"unexpected close with partial: finish degrades to the partial",
		final === "turn on the lamp",
		final,
	)
	await server.close()
}

const closeWithoutText = async (): Promise<void> => {
	const server = await startServer((socket, message) => {
		const m = message as { binary?: boolean }
		if (m.binary) setTimeout(() => socket.terminate(), 40)
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(200)
	const outcome = await session.finish().then(
		() => "resolved",
		() => "rejected",
	)
	checker.check(
		"unexpected close without text: finish rejects",
		outcome === "rejected",
		outcome,
	)
	await server.close()
}

const resetAfterDeltas = async (): Promise<void> => {
	let commits = 0
	const server = await startServer((socket, message) => {
		const m = message as { type?: string; binary?: boolean }
		if (m.binary && commits === 0)
			send(socket, { type: DELTA, item_id: "old", delta: "wrong text" })
		if (m.binary && commits === 1)
			send(socket, { type: DELTA, item_id: "new", delta: "right text" })
		if (m.type === "input_audio_buffer.commit") {
			commits++
			if (commits === 1) {
				send(socket, { type: COMMITTED, item_id: "old" })
				setTimeout(
					() =>
						send(socket, {
							type: COMPLETED,
							item_id: "old",
							transcript: "wrong text.",
						}),
					60,
				)
			} else {
				send(socket, { type: COMMITTED, item_id: "new" })
				send(socket, {
					type: COMPLETED,
					item_id: "new",
					transcript: "right text.",
				})
			}
		}
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(120)
	session.reset(pcm)
	await sleep(200)
	const final = await session.finish()
	checker.check(
		"reset after deltas: stale completed discarded, new generation wins",
		final === "right text.",
		final,
	)
	await server.close()
}

const resetBeforeFirstDelta = async (): Promise<void> => {
	let commits = 0
	const server = await startServer((socket, message) => {
		const m = message as { type?: string; binary?: boolean }
		if (m.type === "input_audio_buffer.commit") {
			commits++
			if (commits === 1) {
				send(socket, { type: COMMITTED, item_id: "ghost" })
				setTimeout(
					() =>
						send(socket, {
							type: COMPLETED,
							item_id: "ghost",
							transcript: "ghost words.",
						}),
					60,
				)
			} else {
				send(socket, { type: COMMITTED, item_id: "fresh" })
				send(socket, {
					type: COMPLETED,
					item_id: "fresh",
					transcript: "fresh words.",
				})
			}
		}
		if (m.binary && commits === 1)
			send(socket, { type: DELTA, item_id: "fresh", delta: "fresh words" })
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(120)
	session.reset(pcm)
	await sleep(220)
	const final = await session.finish()
	checker.check(
		"reset before first delta: ghost completed discarded via committed ack",
		final === "fresh words.",
		final,
	)
	await server.close()
}

const fifoFallbackNoAck = async (): Promise<void> => {
	let commits = 0
	const server = await startServer((socket, message) => {
		const m = message as { type?: string; binary?: boolean }
		if (m.type === "input_audio_buffer.commit") {
			commits++
			if (commits === 1)
				setTimeout(
					() =>
						send(socket, {
							type: COMPLETED,
							item_id: "unknown-old",
							transcript: "stale stuff.",
						}),
					60,
				)
			else
				send(socket, {
					type: COMPLETED,
					item_id: "unknown-new",
					transcript: "current stuff.",
				})
		}
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(80)
	session.reset(pcm)
	await sleep(200)
	const final = await session.finish()
	checker.check(
		"no committed ack: FIFO fallback discards the first pending completed",
		final === "current stuff.",
		final,
	)
	await server.close()
}

const unsolicitedSegment = async (): Promise<void> => {
	const server = await startServer((socket, message) => {
		const m = message as { type?: string; binary?: boolean }
		if (m.binary) {
			send(socket, {
				type: COMPLETED,
				item_id: "s1",
				transcript: "first segment.",
			})
			send(socket, { type: DELTA, item_id: "s2", delta: "second part" })
		}
		if (m.type === "input_audio_buffer.commit")
			send(socket, {
				type: COMPLETED,
				item_id: "s2",
				transcript: "second part.",
			})
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(150)
	const final = await session.finish()
	checker.check(
		"unsolicited endpoint completed: segments concatenate",
		final === "first segment. second part.",
		final,
	)
	await server.close()
}

const resetBeforeHandshake = async (): Promise<void> => {
	const binarySizes: number[] = []
	const server = await startServer((socket, message) => {
		const m = message as { type?: string; binary?: boolean; size?: number }
		if (m.binary) binarySizes.push(m.size ?? 0)
		if (m.type === "input_audio_buffer.commit") {
			send(socket, { type: COMMITTED, item_id: "r1" })
			send(socket, {
				type: COMPLETED,
				item_id: "r1",
				transcript: "second take.",
			})
		}
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(Buffer.alloc(640))
	session.reset(Buffer.alloc(320))
	await sleep(150)
	const final = await session.finish()
	checker.check(
		"reset before handshake: only the new generation's audio is sent",
		binarySizes.length === 1 && binarySizes[0] === 320,
		JSON.stringify(binarySizes),
	)
	checker.check(
		"reset before handshake: finish returns the new transcript",
		final === "second take.",
		final,
	)
	await server.close()
}

const overlappingCommits = async (): Promise<void> => {
	let commits = 0
	const server = await startServer((socket, message) => {
		const m = message as { type?: string; binary?: boolean }
		if (m.binary && commits === 0)
			send(socket, { type: DELTA, item_id: "old", delta: "old text" })
		if (m.binary && commits === 1)
			send(socket, { type: DELTA, item_id: "new", delta: "new text" })
		if (m.type === "input_audio_buffer.commit") {
			commits++
			if (commits === 1) {
				send(socket, { type: COMMITTED, item_id: "old" })
				setTimeout(
					() =>
						send(socket, {
							type: COMPLETED,
							item_id: "old",
							transcript: "old text.",
						}),
					300,
				)
			} else {
				send(socket, { type: COMMITTED, item_id: "new" })
				setTimeout(
					() =>
						send(socket, {
							type: COMPLETED,
							item_id: "new",
							transcript: "new text.",
						}),
					300,
				)
			}
		}
	})
	const session = createNemoSpeechSession(domiaFor(server.port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(120)
	session.reset(pcm)
	await sleep(100)
	const final = await session.finish()
	checker.check(
		"overlapping commits: new ack before old completion keeps the new generation",
		final === "new text.",
		final,
	)
	await server.close()
}

const handshakeStall = async (): Promise<void> => {
	const tcp = createTcpServer(() => undefined)
	await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve))
	const address = tcp.address()
	const port = typeof address === "object" && address ? address.port : 0
	const session = createNemoSpeechSession(domiaFor(port))
	if (!session) throw new Error("session null")
	session.pushChunk(pcm)
	await sleep(100)
	const started = Date.now()
	const outcome = await session.finish().then(
		() => "resolved",
		() => "rejected",
	)
	const elapsed = Date.now() - started
	checker.check(
		"stalled handshake: finish rejects instead of empty success",
		outcome === "rejected",
		outcome,
	)
	checker.check(
		"stalled handshake: rejects at the session timeout, not a second one",
		elapsed < 1200,
		`${elapsed}ms`,
	)
	await new Promise<void>((resolve) => tcp.close(() => resolve()))
}

const main = async (): Promise<void> => {
	await happyPath()
	await handshakeFail()
	await errorMidUtterance()
	await closeWithPartial()
	await closeWithoutText()
	await resetAfterDeltas()
	await resetBeforeFirstDelta()
	await fifoFallbackNoAck()
	await unsolicitedSegment()
	await resetBeforeHandshake()
	await overlappingCommits()
	await handshakeStall()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} nemo-session checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()

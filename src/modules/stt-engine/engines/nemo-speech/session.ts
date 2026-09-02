import WebSocket from "ws"

import { DEFAULT_STT_TIMEOUT_MS } from "@/db"
import { sttEngineLogger, STT_ERRORS, domiaError } from "@/utils"
import type { DomiaType } from "@/modules/core"

import type {
	SttStreamSessionType,
	NemoSpeechServerEventType,
	NemoSpeechPendingCommitType,
} from "../../types"

const SAMPLE_RATE = 16000
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000
const SERVER_ENDPOINTING_MS = 30000
const HANDSHAKE_TIMEOUT_MS = 3000
const DELTA_SETTLE_STEP_MS = 30
const DELTA_SETTLE_QUIET_ROUNDS = 2
const DELTA_SETTLE_MAX_ROUNDS = 12

const DELTA_EVENT = "conversation.item.input_audio_transcription.delta"
const COMPLETED_EVENT = "conversation.item.input_audio_transcription.completed"
const COMMITTED_EVENT = "input_audio_buffer.committed"

export const realtimeUrlOf = (baseUrl: string): string =>
	`${baseUrl.replace(/\/$/, "").replace(/^http/, "ws")}/realtime`

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

const silenceOf = (padMs: number): Buffer =>
	Buffer.alloc(Math.round(padMs * BYTES_PER_MS) & ~1)

export const createNemoSpeechSession = (
	domia: DomiaType,
): SttStreamSessionType | null => {
	const config = domia.sttConfig
	const baseUrl = config?.baseUrl?.trim()
	if (!baseUrl) return null
	const timeoutMs = config?.timeoutMs ?? DEFAULT_STT_TIMEOUT_MS
	const apiKey = config?.apiKey?.trim()

	let ws: WebSocket | null = null
	let opened = false
	let closed = false
	const backlog: Buffer[] = []
	const openWaiters: (() => void)[] = []
	let finalizedText = ""
	let currentText = ""
	let lastDeltaAt = 0
	let generation = 0
	let activeItemId: string | null = null
	const pendingCommits: NemoSpeechPendingCommitType[] = []
	let failed = false
	let finalResolve: ((text: string) => void) | null = null

	const joined = (): string =>
		[finalizedText, currentText].filter(Boolean).join(" ").trim()

	const settleFinal = (): void => {
		if (!finalResolve) return
		const resolve = finalResolve
		finalResolve = null
		resolve(joined())
	}

	const hasStalePending = (): boolean =>
		pendingCommits.some((pending) => pending.generation < generation)

	const isStaleItem = (itemId: string): boolean =>
		pendingCommits.some(
			(pending) => pending.itemId === itemId && pending.generation < generation,
		)

	const enqueueCommit = (): void => {
		pendingCommits.push({ generation, itemId: activeItemId })
		sendJson({ type: "input_audio_buffer.commit" })
	}

	const takePendingFor = (
		itemId: string | undefined,
	): NemoSpeechPendingCommitType | null => {
		const byId = itemId
			? pendingCommits.findIndex((pending) => pending.itemId === itemId)
			: -1
		const index = byId >= 0 ? byId : pendingCommits.length > 0 ? 0 : -1
		if (index < 0) return null
		return pendingCommits.splice(index, 1)[0] ?? null
	}

	const handleEvent = (event: NemoSpeechServerEventType): void => {
		if (event.type === DELTA_EVENT) {
			if (event.item_id) {
				if (isStaleItem(event.item_id)) return
				activeItemId = event.item_id
			} else if (hasStalePending()) return
			if (!event.delta) return
			currentText += event.delta
			lastDeltaAt = Date.now()
			return
		}
		if (event.type === COMMITTED_EVENT) {
			if (!event.item_id) return
			if (pendingCommits.some((pending) => pending.itemId === event.item_id))
				return
			const unlabeled = pendingCommits.find(
				(pending) => pending.itemId === null,
			)
			if (unlabeled) unlabeled.itemId = event.item_id
			return
		}
		if (event.type === COMPLETED_EVENT) {
			const pending = takePendingFor(event.item_id)
			if (pending && pending.generation < generation) return
			currentText = ""
			activeItemId = null
			const transcript = (event.transcript ?? "").trim()
			if (transcript)
				finalizedText = [finalizedText, transcript].filter(Boolean).join(" ")
			settleFinal()
			return
		}
		if (event.type === "error") {
			failed = true
			sttEngineLogger.warn("nemo-speech realtime error event", {
				domiaId: domia.id,
				error: event.error ?? event,
			})
			settleFinal()
		}
	}

	const connect = (): WebSocket => {
		const socket = new WebSocket(realtimeUrlOf(baseUrl), {
			handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
			headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
		})
		socket.on("open", () => {
			socket.send(
				JSON.stringify({
					type: "session.update",
					session: {
						sample_rate: SAMPLE_RATE,
						language: config?.language ?? "en",
						automatic_punctuation: true,
						endpointing_ms: SERVER_ENDPOINTING_MS,
					},
				}),
			)
			opened = true
			for (const chunk of backlog.splice(0)) socket.send(chunk)
			for (const wake of openWaiters.splice(0)) wake()
		})
		socket.on("message", (data, isBinary) => {
			if (isBinary) return
			try {
				handleEvent(JSON.parse(String(data)) as NemoSpeechServerEventType)
			} catch {
				sttEngineLogger.warn("nemo-speech unparseable realtime message", {
					domiaId: domia.id,
				})
			}
		})
		socket.on("error", (err) => {
			failed = true
			sttEngineLogger.warn("nemo-speech realtime socket error", {
				domiaId: domia.id,
				err,
			})
		})
		socket.on("close", () => {
			if (!closed && joined() === "") failed = true
			opened = false
			settleFinal()
			for (const wake of openWaiters.splice(0)) wake()
		})
		return socket
	}

	const send = (chunk: Buffer): void => {
		if (closed || chunk.length === 0) return
		if (!ws) ws = connect()
		if (opened && ws.readyState === WebSocket.OPEN) ws.send(chunk)
		else backlog.push(chunk)
	}

	const sendJson = (message: Record<string, unknown>): void => {
		if (ws && opened && ws.readyState === WebSocket.OPEN)
			ws.send(JSON.stringify(message))
	}

	const waitOpen = (): Promise<boolean> => {
		if (opened) return Promise.resolve(true)
		if (!ws || failed || ws.readyState === WebSocket.CLOSED)
			return Promise.resolve(false)
		return new Promise((resolve) => {
			openWaiters.push(() => resolve(opened))
			setTimeout(() => resolve(opened), timeoutMs)
		})
	}

	const settleDeltas = async (): Promise<void> => {
		let quietRounds = 0
		for (let round = 0; round < DELTA_SETTLE_MAX_ROUNDS; round++) {
			const seen = lastDeltaAt
			await sleep(DELTA_SETTLE_STEP_MS)
			quietRounds = lastDeltaAt === seen ? quietRounds + 1 : 0
			if (quietRounds >= DELTA_SETTLE_QUIET_ROUNDS) return
		}
	}

	const teardown = (): void => {
		closed = true
		settleFinal()
		if (!ws) return
		const socket = ws
		ws = null
		opened = false
		socket.removeAllListeners()
		socket.on("error", () => undefined)
		if (socket.readyState === WebSocket.CONNECTING) {
			socket.terminate()
			return
		}
		try {
			socket.close()
		} catch {
			socket.terminate()
		}
	}

	return {
		pushChunk: (pcm) => send(pcm),
		partial: () => joined(),
		flushPartial: async (padMs) => {
			if (closed) return joined()
			if (padMs > 0) send(silenceOf(padMs))
			await settleDeltas()
			return joined()
		},
		finish: async () => {
			if (closed || !ws) {
				teardown()
				return joined()
			}
			try {
				const isOpen = await waitOpen()
				if (!isOpen) {
					const partial = joined()
					if (partial === "")
						throw domiaError(STT_ERRORS.TRANSCRIPTION_FAILED, {
							logger: sttEngineLogger,
							meta: {
								domiaId: domia.id,
								reason: failed
									? "nemo-speech realtime session failed"
									: "nemo-speech realtime socket never opened",
							},
						})
					return partial
				}
				const finalPromise = new Promise<string>((resolve) => {
					finalResolve = resolve
					setTimeout(() => {
						if (!finalResolve) return
						finalResolve = null
						resolve(joined())
					}, timeoutMs).unref()
				})
				enqueueCommit()
				const text = await finalPromise
				if (failed && text === "")
					throw domiaError(STT_ERRORS.TRANSCRIPTION_FAILED, {
						logger: sttEngineLogger,
						meta: {
							domiaId: domia.id,
							reason: "nemo-speech realtime session failed mid-utterance",
						},
					})
				return text
			} finally {
				teardown()
			}
		},
		reset: (pcm) => {
			if (closed) return
			finalizedText = ""
			currentText = ""
			if (ws && opened) {
				enqueueCommit()
				generation++
				activeItemId = null
			} else {
				backlog.length = 0
			}
			if (pcm && pcm.length > 0) send(pcm)
		},
		abort: () => teardown(),
	}
}

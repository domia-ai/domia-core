import {
	onTurnEvent,
	DOMIA_TURN_EVENT_ENUM,
	type DomiaTurnEventType,
} from "@/buses"
import { domiaBusLogger, turnEventsLogger } from "@/utils"
import { persistTurnEventBatch } from "@/modules/session-manager"

const TURN_COMPLETE_TIMING_KEYS = [
	"ttfaMs",
	"perceivedTtfaMs",
	"llmQueueMs",
	"llmFirstSentenceMs",
	"ttsFirstChunkMs",
	"llmMs",
	"ttsMs",
	"totalMs",
] as const

const TERMINAL_TYPES = new Set<DOMIA_TURN_EVENT_ENUM>([
	DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED,
	DOMIA_TURN_EVENT_ENUM.TURN_FAILED,
	DOMIA_TURN_EVENT_ENUM.TURN_ABORTED,
])

const TURN_EVENT_BUFFER_MAX = 256

export const setupTurnEventLogging = (): void => {
	onTurnEvent({ types: [DOMIA_TURN_EVENT_ENUM.TURN_COMPLETED] }, (event) => {
		const e = event as Record<string, unknown>
		const timings = Object.fromEntries(
			TURN_COMPLETE_TIMING_KEYS.filter((k) => e[k] !== undefined).map((k) => [
				k,
				e[k],
			]),
		)
		domiaBusLogger.info(
			`TURN_COMPLETE ${JSON.stringify({
				id: event.interactionId,
				status: e.status,
				...timings,
			})}`,
			{ interactionId: event.interactionId },
		)
	})
}

export const setupTurnEventPersistence = (): void => {
	const buffers = new Map<string, DomiaTurnEventType[]>()
	const flushed = new Set<string>()

	const buffer = (event: DomiaTurnEventType): void => {
		const existing = buffers.get(event.interactionId)
		if (existing) {
			existing.push(event)
			buffers.delete(event.interactionId)
			buffers.set(event.interactionId, existing)
		} else {
			buffers.set(event.interactionId, [event])
		}
		if (buffers.size > TURN_EVENT_BUFFER_MAX) {
			const oldest = buffers.keys().next().value
			if (oldest !== undefined) buffers.delete(oldest)
		}
	}

	const rememberFlushed = (id: string): void => {
		flushed.add(id)
		if (flushed.size > TURN_EVENT_BUFFER_MAX) {
			const oldest = flushed.values().next().value
			if (oldest !== undefined) flushed.delete(oldest)
		}
	}

	const persist = (id: string, events: DomiaTurnEventType[]): void => {
		void persistTurnEventBatch(id, events).catch((err) =>
			turnEventsLogger.warn("turn-event persist failed", {
				interactionId: id,
				err,
			}),
		)
	}

	onTurnEvent("*", (event) => {
		if (flushed.has(event.interactionId)) {
			persist(event.interactionId, [event])
			return
		}
		buffer(event)
		if (!TERMINAL_TYPES.has(event.type)) return
		const events = buffers.get(event.interactionId) ?? [event]
		buffers.delete(event.interactionId)
		rememberFlushed(event.interactionId)
		persist(event.interactionId, events)
	})
}

import { turnEventsLogger } from "@/utils"
import { TURN_EVENT_SEQ_LRU_MAX } from "./constants"
import { publishTurnEventDiagnostics } from "./diagnostics"
import type {
	DomiaTurnEventInputType,
	DomiaTurnEventType,
	TurnEventFilterType,
	TurnEventListenerType,
	RegisteredListenerType,
} from "./types"

const listeners = new Set<RegisteredListenerType>()
const seqByInteraction = new Map<string, number>()

const nextSeq = (interactionId: string): number => {
	const seq = (seqByInteraction.get(interactionId) ?? 0) + 1
	seqByInteraction.delete(interactionId)
	seqByInteraction.set(interactionId, seq)
	if (seqByInteraction.size > TURN_EVENT_SEQ_LRU_MAX) {
		const oldest = seqByInteraction.keys().next().value
		if (oldest !== undefined) seqByInteraction.delete(oldest)
	}
	return seq
}

const matches = (
	filter: TurnEventFilterType,
	event: DomiaTurnEventType,
): boolean => {
	if (filter === "*") return true
	if (
		filter.domiaKey &&
		filter.domiaKey !== event.originDomiaKey &&
		filter.domiaKey !== event.executorDomiaKey
	)
		return false
	if (filter.interactionId && filter.interactionId !== event.interactionId)
		return false
	if (filter.satelliteId && filter.satelliteId !== event.satelliteId)
		return false
	if (filter.types && !filter.types.includes(event.type)) return false
	return true
}

export const onTurnEvent = (
	filter: TurnEventFilterType,
	listener: TurnEventListenerType,
): (() => void) => {
	const entry: RegisteredListenerType = { filter, listener }
	listeners.add(entry)
	return () => {
		listeners.delete(entry)
	}
}

export const emitTurnEvent = (input: DomiaTurnEventInputType): void => {
	const event = {
		...input,
		ts: Date.now(),
		seq: nextSeq(input.interactionId),
	} as DomiaTurnEventType

	publishTurnEventDiagnostics(event)

	setImmediate(() => {
		for (const { filter, listener } of listeners) {
			if (!matches(filter, event)) continue
			try {
				const result = listener(event)
				if (result instanceof Promise)
					result.catch((err) =>
						turnEventsLogger.warn("turn-event listener rejected", {
							type: event.type,
							err,
						}),
					)
			} catch (err) {
				turnEventsLogger.warn("turn-event listener threw", {
					type: event.type,
					err,
				})
			}
		}
	})
}

import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { grpcServerLogger, runWithTraceContext, writeWavToTemp } from "@/utils"
import type { EventEnvelope, DeliveryAck } from "@/generated/proto/domia"
import type { GrpcEventHandlerContextType, DedupEntry } from "../types"

const DEDUP_TTL_MS = 5 * 60 * 1000

const dedupCache = new Map<string, DedupEntry>()

const dedupKey = (interactionId: string, eventName: string): string =>
	`${interactionId}::${eventName}`

const isDuplicate = (key: string): boolean => {
	const now = Date.now()
	for (const [k, v] of dedupCache) {
		if (now - v.timestamp > DEDUP_TTL_MS) {
			dedupCache.delete(k)
		}
	}
	const entry = dedupCache.get(key)
	if (entry && now - entry.timestamp <= DEDUP_TTL_MS) {
		return true
	}
	dedupCache.set(key, { timestamp: now })
	return false
}

export const handleDeliverEvent = async (
	ctx: GrpcEventHandlerContextType,
	envelope: EventEnvelope,
): Promise<DeliveryAck> => {
	const { domia } = ctx
	const senderKey = envelope.senderDomiaKey || "unknown"

	if (!envelope.payload?.$case) {
		return { accepted: false, reason: "empty payload", deduplicated: false }
	}

	let event: DOMIA_EVENT_BUS_ENUM
	let interactionId: string | undefined
	let busPayload: Record<string, unknown>

	switch (envelope.payload.$case) {
		case "audioReady": {
			const p = envelope.payload.audioReady
			event = DOMIA_EVENT_BUS_ENUM.AUDIO_READY
			interactionId = p.interactionId
			const filePath =
				p.audio && p.audio.length > 0
					? await writeWavToTemp(p.audio, p.interactionId ?? "", "audio-in")
					: p.filePath
			busPayload = {
				filePath,
				audioUrl: p.audioUrl,
				originDomiaKey: p.originDomiaKey,
				interactionId: p.interactionId,
			}
			break
		}
		case "sttDone": {
			const p = envelope.payload.sttDone
			event = DOMIA_EVENT_BUS_ENUM.STT_DONE
			interactionId = p.interactionId
			busPayload = {
				transcript: p.transcript,
				interactionId: p.interactionId,
				originDomiaKey: p.originDomiaKey,
				responseType: p.responseType,
			}
			break
		}
		case "llmDone": {
			const p = envelope.payload.llmDone
			event = DOMIA_EVENT_BUS_ENUM.LLM_DONE
			interactionId = p.interactionId
			busPayload = {
				reply: p.reply,
				interactionId: p.interactionId,
				originDomiaKey: p.originDomiaKey,
				responseType: p.responseType,
			}
			break
		}
		case "ttsDone": {
			const p = envelope.payload.ttsDone
			event = DOMIA_EVENT_BUS_ENUM.TTS_DONE
			interactionId = p.interactionId
			const filePath =
				p.audio && p.audio.length > 0
					? await writeWavToTemp(p.audio, p.interactionId ?? "", "tts-in")
					: p.filePath
			busPayload = {
				filePath,
				audioUrl: p.audioUrl,
				interactionId: p.interactionId,
				originDomiaKey: p.originDomiaKey,
			}
			break
		}
		default:
			return {
				accepted: false,
				reason: `unsupported payload case`,
				deduplicated: false,
			}
	}

	if (interactionId) {
		const key = dedupKey(interactionId, event)
		if (isDuplicate(key)) {
			grpcServerLogger.warn(
				`🔁 deduplicated ${event} from ${senderKey} (interaction ${interactionId})`,
			)
			return { accepted: true, reason: "deduplicated", deduplicated: true }
		}
	}

	return runWithTraceContext(
		{ interactionId, originDomiaKey: senderKey },
		() => {
			grpcServerLogger.info(
				`📥 deliverEvent ${event} from ${senderKey} → bus`,
				{ domiaId: domia.id, interactionId },
			)
			publishToDomiaBus(domia.id, event, busPayload as never)
			return { accepted: true, reason: "ok", deduplicated: false }
		},
	)
}

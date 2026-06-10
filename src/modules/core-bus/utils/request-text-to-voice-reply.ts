import {
	publishToDomiaBus,
	subscribeToDomiaBus,
	unsubscribeFromDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	type DomiaEventBusPayloadMapType,
} from "@/buses"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import type { DomiaType } from "@/modules/core"
import { getOrCreateInteractionId } from "@/modules/session-manager"
import type {
	LlmDonePayloadType,
	TtsDonePayloadType,
	InteractionFailedPayloadType,
	PlaybackStartedPayloadType,
	PlaybackFinishedPayloadType,
	RequestVoiceReplyOptions,
	RequestTextToVoiceReplyResult,
} from "../types"

const DEFAULT_TIMEOUT_MS = 60_000

export const requestTextToVoiceReply = async (
	domia: DomiaType,
	text: string,
	options: RequestVoiceReplyOptions = {},
): Promise<RequestTextToVoiceReplyResult> => {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, onStage } = options

	const interactionId = await getOrCreateInteractionId(domia, undefined, {
		inputType: INTERACTION_INPUT_TYPE_ENUM.TEXT,
		responseType: RESPONSE_TYPE_ENUM.VOICE,
	})
	if (!interactionId) {
		throw new Error("requestTextToVoiceReply: failed to create interaction")
	}

	const domiaId = domia.id
	const t0 = Date.now()
	let reply = ""
	let ttsFilePath: string | undefined
	const subs: {
		event: DOMIA_EVENT_BUS_ENUM
		fn: (p: unknown) => void
	}[] = []

	const sub = <E extends DOMIA_EVENT_BUS_ENUM>(
		event: E,
		fn: (p: DomiaEventBusPayloadMapType[E]) => void,
	) => {
		subs.push({ event, fn: fn as (p: unknown) => void })
		subscribeToDomiaBus(domiaId, event, fn)
	}

	const cleanup = () => {
		for (const { event, fn } of subs) {
			unsubscribeFromDomiaBus(domiaId, event, fn)
		}
	}

	try {
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(
					new Error(`requestTextToVoiceReply: timeout after ${timeoutMs}ms`),
				)
			}, timeoutMs)

			sub(DOMIA_EVENT_BUS_ENUM.LLM_DONE, (p: LlmDonePayloadType) => {
				if (p.interactionId !== interactionId) return
				reply = p.reply
				onStage?.("llm", Date.now() - t0)
			})
			sub(DOMIA_EVENT_BUS_ENUM.TTS_DONE, (p: TtsDonePayloadType) => {
				if (p.interactionId !== interactionId) return
				ttsFilePath = p.filePath
				onStage?.("tts", Date.now() - t0)
				clearTimeout(timeout)
				resolve()
			})
			sub(
				DOMIA_EVENT_BUS_ENUM.PLAYBACK_STARTED,
				(p: PlaybackStartedPayloadType) => {
					if (p.interactionId !== interactionId) return
					onStage?.("firstAudioChunk", Date.now() - t0)
				},
			)
			sub(
				DOMIA_EVENT_BUS_ENUM.PLAYBACK_FINISHED,
				(p: PlaybackFinishedPayloadType) => {
					if (p.interactionId !== interactionId) return
					clearTimeout(timeout)
					resolve()
				},
			)
			sub(
				DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
				(p: InteractionFailedPayloadType) => {
					if (p.interactionId !== interactionId) return
					clearTimeout(timeout)
					reject(
						new Error(
							`requestTextToVoiceReply: failed at ${p.step ?? "unknown"}: ${p.error}`,
						),
					)
				},
			)

			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
				transcript: text,
				interactionId,
				originDomiaKey: domia.domiaKey,
				responseType: RESPONSE_TYPE_ENUM.VOICE,
			})
		})
	} finally {
		cleanup()
	}

	return { interactionId, reply, ttsFilePath }
}

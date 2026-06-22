import { existsSync } from "fs"
import path from "path"

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
import { prefetchMemoryBundle } from "./prefetch-memory"
import { beginTurn } from "./turn-scope"
import { setPresenceStatus } from "./presence-registry"
import type {
	SttDonePayloadType,
	LlmDonePayloadType,
	TtsDonePayloadType,
	InteractionFailedPayloadType,
	PlaybackStartedPayloadType,
	PlaybackFinishedPayloadType,
	RequestVoiceReplyOptions,
	RequestVoiceReplyResult,
} from "../types"

const DEFAULT_TIMEOUT_MS = 60_000

export const requestVoiceReply = async (
	domia: DomiaType,
	audioPath: string,
	options: RequestVoiceReplyOptions = {},
): Promise<RequestVoiceReplyResult> => {
	const {
		timeoutMs = DEFAULT_TIMEOUT_MS,
		speak = true,
		onStage,
		interactionId: providedId,
	} = options

	const absPath = path.resolve(audioPath)
	if (!existsSync(absPath)) {
		throw new Error(`requestVoiceReply: audio file not found: ${absPath}`)
	}

	const interactionId = await getOrCreateInteractionId(domia, providedId, {
		inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
		responseType: speak ? RESPONSE_TYPE_ENUM.VOICE : RESPONSE_TYPE_ENUM.TEXT,
		inputAudioPath: absPath,
	})
	if (!interactionId) {
		throw new Error("requestVoiceReply: failed to create interaction")
	}
	prefetchMemoryBundle(domia, interactionId)

	const domiaId = domia.id
	const turn = beginTurn(domiaId, interactionId)
	setPresenceStatus(domia.domiaKey, "thinking", true)
	const t0 = Date.now()
	let transcript = ""
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
				turn.abort("timeout")
				reject(new Error(`requestVoiceReply: timeout after ${timeoutMs}ms`))
			}, timeoutMs)

			sub(DOMIA_EVENT_BUS_ENUM.STT_DONE, (p: SttDonePayloadType) => {
				if (p.interactionId !== interactionId) return
				transcript = p.transcript
				onStage?.("stt", Date.now() - t0)
			})
			sub(DOMIA_EVENT_BUS_ENUM.LLM_DONE, (p: LlmDonePayloadType) => {
				if (p.interactionId !== interactionId) return
				reply = p.reply
				onStage?.("llm", Date.now() - t0)
				if (!speak) {
					clearTimeout(timeout)
					resolve()
				}
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
					setPresenceStatus(domia.domiaKey, "speaking")
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
							`requestVoiceReply: failed at ${p.step ?? "unknown"}: ${p.error}`,
						),
					)
				},
			)

			publishToDomiaBus(domiaId, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
				filePath: absPath,
				interactionId,
				originDomiaKey: domia.domiaKey,
			})
		})
	} finally {
		cleanup()
		turn.end()
		setPresenceStatus(domia.domiaKey, "idle", true)
	}

	return { interactionId, transcript, reply, ttsFilePath }
}

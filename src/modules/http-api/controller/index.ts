import { createReadStream, existsSync } from "fs"
import path from "path"
import { type DomiaType } from "@/modules/core"
import type {
	PostChatBodyType,
	PostChatResponseType,
	GetAudioRouteType,
	PostVoiceBodyType,
	PostVoiceResponseType,
} from "../types"
import { postChatBodySchema, postVoiceBodySchema } from "../schemas"
import {
	requestTextReply,
	getAudioFilePath,
	registerAudioForServing,
	type SttDonePayloadType,
	type LlmDonePayloadType,
	type TtsDonePayloadType,
	type InteractionFailedPayloadType,
} from "@/modules/core-bus"
import {
	publishToDomiaBus,
	subscribeToDomiaBus,
	unsubscribeFromDomiaBus,
	DOMIA_EVENT_BUS_ENUM,
	type DomiaEventBusPayloadMapType,
} from "@/buses"
import { getOrCreateInteractionId } from "@/modules/session-manager"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import { httpServerLogger } from "@/utils"
import type { FastifyRequest, FastifyReply } from "fastify"

const VOICE_FLOW_TIMEOUT_MS = 60_000

export const handleGetRoot = () => {
	return { message: "DOMIA HTTP Server is running ✅" }
}

export const handleGetHealth = () => {
	return { status: "ok", timestamp: new Date().toISOString() }
}

export const handleGetAudio = async (
	request: FastifyRequest<GetAudioRouteType>,
	reply: FastifyReply,
) => {
	const { interactionId } = request.params
	const filePath = getAudioFilePath(interactionId)
	if (!filePath) {
		return reply.code(404).send({ error: "Audio not found or expired" })
	}
	const stream = createReadStream(filePath)
	return reply.type("audio/wav").send(stream)
}

export const handlePostChat = async (
	domia: DomiaType,
	body: PostChatBodyType,
): Promise<PostChatResponseType> => {
	const { text } = postChatBodySchema.parse(body)
	try {
		const reply = await requestTextReply(domia, text)
		return { reply }
	} catch (err) {
		httpServerLogger.error("Chat request failed", { domiaId: domia.id, err })
		throw err
	}
}

export const handlePostVoice = async (
	domia: DomiaType,
	body: PostVoiceBodyType,
): Promise<PostVoiceResponseType> => {
	const { filePath } = postVoiceBodySchema.parse(body)
	const absPath = path.resolve(filePath)
	if (!existsSync(absPath)) {
		throw new Error(`Audio file not found: ${absPath}`)
	}

	const interactionId = await getOrCreateInteractionId(domia, undefined, {
		inputType: INTERACTION_INPUT_TYPE_ENUM.VOICE,
		responseType: RESPONSE_TYPE_ENUM.VOICE,
		inputAudioPath: absPath,
	})
	if (!interactionId) {
		throw new Error("Failed to create interaction")
	}

	const domiaId = domia.id
	const t0 = Date.now()
	const stages: { sttDone?: number; llmDone?: number; ttsDone?: number } = {}
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
				reject(new Error(`voice flow timeout after ${VOICE_FLOW_TIMEOUT_MS}ms`))
			}, VOICE_FLOW_TIMEOUT_MS)

			sub(DOMIA_EVENT_BUS_ENUM.STT_DONE, (p: SttDonePayloadType) => {
				if (p.interactionId !== interactionId) return
				stages.sttDone = Date.now() - t0
				transcript = p.transcript
			})
			sub(DOMIA_EVENT_BUS_ENUM.LLM_DONE, (p: LlmDonePayloadType) => {
				if (p.interactionId !== interactionId) return
				stages.llmDone = Date.now() - t0
				reply = p.reply
			})
			sub(DOMIA_EVENT_BUS_ENUM.TTS_DONE, (p: TtsDonePayloadType) => {
				if (p.interactionId !== interactionId) return
				stages.ttsDone = Date.now() - t0
				ttsFilePath = p.filePath
				clearTimeout(timeout)
				resolve()
			})
			sub(
				DOMIA_EVENT_BUS_ENUM.INTERACTION_FAILED,
				(p: InteractionFailedPayloadType) => {
					if (p.interactionId !== interactionId) return
					clearTimeout(timeout)
					reject(
						new Error(
							`Voice flow failed at ${p.step ?? "unknown"}: ${p.error}`,
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

		let audioUrl: string | null = null
		if (ttsFilePath) {
			registerAudioForServing(interactionId, ttsFilePath)
			audioUrl = `/audio/${interactionId}`
		}

		return {
			interactionId,
			transcript,
			reply,
			audioUrl,
			timings: {
				sttMs: stages.sttDone ?? 0,
				llmMs: (stages.llmDone ?? 0) - (stages.sttDone ?? 0),
				ttsMs: (stages.ttsDone ?? 0) - (stages.llmDone ?? 0),
				totalMs: stages.ttsDone ?? 0,
			},
		}
	} catch (err) {
		httpServerLogger.error("Voice request failed", {
			domiaId,
			interactionId,
			err,
		})
		throw err
	} finally {
		cleanup()
	}
}

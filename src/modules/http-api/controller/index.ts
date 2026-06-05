import { createReadStream, existsSync } from "fs"
import { type DomiaType } from "@/modules/core"
import {
	getInteractionById,
	getInteractionsSince,
	getSessionsSince,
} from "@/modules/session-manager"
import { getEmotionEventsSince } from "@/modules/emotion-engine"
import { getFactsSince } from "@/modules/memory"
import {
	serializeMind,
	importMind,
	listTemplates,
	activateTemplate,
} from "@/modules/mind"
import type {
	PostChatBodyType,
	PostChatResponseType,
	GetAudioRouteType,
	GetSyncQueryType,
	GetSyncResponseType,
	PostVoiceBodyType,
	PostVoiceResponseType,
	PostImportMindBodyType,
} from "../types"
import {
	postChatBodySchema,
	postVoiceBodySchema,
	postImportMindBodySchema,
	getSyncQuerySchema,
	getAudioQuerySchema,
} from "../schemas"
import {
	requestTextReply,
	getAudioFilePath,
	registerAudioForServing,
	requestVoiceReply,
	type RequestVoiceReplyStage,
} from "@/modules/core-bus"
import { httpServerLogger } from "@/utils"
import type { FastifyRequest, FastifyReply } from "fastify"

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
	const { kind } = getAudioQuerySchema.parse(request.query)
	let filePath = kind === "tts" ? getAudioFilePath(interactionId) : null
	if (!filePath) {
		const row = await getInteractionById(interactionId)
		filePath =
			kind === "input"
				? (row?.inputAudioPath ?? null)
				: (row?.ttsAudioPath ?? null)
	}
	if (!filePath || !existsSync(filePath)) {
		return reply.code(404).send({ error: "Audio not found" })
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
	try {
		const stages: Partial<Record<RequestVoiceReplyStage, number>> = {}
		const result = await requestVoiceReply(domia, filePath, {
			onStage: (stage, elapsedMs) => {
				stages[stage] = elapsedMs
			},
		})
		const audioUrl = result.ttsFilePath
			? (registerAudioForServing(result.interactionId, result.ttsFilePath),
				`/audio/${result.interactionId}`)
			: null
		return {
			interactionId: result.interactionId,
			transcript: result.transcript,
			reply: result.reply,
			audioUrl,
			timings: {
				sttMs: stages.stt ?? 0,
				llmMs: (stages.llm ?? 0) - (stages.stt ?? 0),
				ttsMs: (stages.tts ?? 0) - (stages.llm ?? 0),
				ttfaMs: stages.firstAudioChunk ?? 0,
				totalMs: stages.tts ?? 0,
			},
		}
	} catch (err) {
		httpServerLogger.error("Voice request failed", { domiaId: domia.id, err })
		throw err
	}
}

export const handleGetMind = async (domia: DomiaType) => {
	return { mind: serializeMind(domia) }
}

export const handleImportMind = async (
	domia: DomiaType,
	body: PostImportMindBodyType,
	reply: FastifyReply,
) => {
	const { mind } = postImportMindBodySchema.parse(body)
	try {
		return { mind: importMind(domia, mind) }
	} catch (err) {
		httpServerLogger.error("Import mind failed", { domiaId: domia.id, err })
		return reply.code(400).send({ error: "Invalid mind bundle" })
	}
}

export const handleGetTemplates = async () => {
	return { templates: listTemplates() }
}

export const handleActivateTemplate = async (
	domia: DomiaType,
	id: string,
	reply: FastifyReply,
) => {
	try {
		return { mind: activateTemplate(domia, id) }
	} catch (err) {
		httpServerLogger.error("Activate template failed", {
			domiaId: domia.id,
			err,
		})
		return reply.code(404).send({ error: "Template not found" })
	}
}

export const handleGetSync = async (
	domia: DomiaType,
	query: GetSyncQueryType,
): Promise<GetSyncResponseType> => {
	const { since, limit } = getSyncQuerySchema.parse(query)
	const domiaId = domia.id

	const [interactions, sessions, emotionEvents, facts] = await Promise.all([
		getInteractionsSince(domiaId, since, limit),
		getSessionsSince(domiaId, since, limit),
		getEmotionEventsSince(domiaId, since, limit),
		getFactsSince(domiaId, since, limit),
	])

	const stamps = [
		...interactions.map((r) => r.createdAt),
		...emotionEvents.map((r) => r.createdAt),
		...facts.map((r) => r.updatedAt),
		...sessions.map((r) => r.updatedAt),
	].filter((s): s is string => Boolean(s))
	const nextCursor = stamps.length
		? stamps.reduce((a, b) => (a > b ? a : b))
		: since

	return { interactions, sessions, emotionEvents, facts, nextCursor }
}

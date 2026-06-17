import { createReadStream, existsSync } from "fs"
import { ZodError } from "zod"
import { writeFile } from "fs/promises"
import { join, resolve, sep } from "path"
import { generateUuid } from "@/utils"
import { DEFAULT_OLLAMA_HOST } from "@/db"
import { type DomiaType } from "@/modules/core"
import { requestRestart } from "@/modules/runtime-control"
import { RECORDINGS_DIR } from "@/modules/audio-capture/constants"
import {
	getInteractionById,
	getInteractionsSince,
	getSessionsSince,
	updateInteraction,
} from "@/modules/session-manager"
import { getEmotionEventsSince } from "@/modules/emotion-engine"
import { getFactsSince } from "@/modules/memory"
import {
	serializeMind,
	importMind,
	listTemplates,
	activateTemplate,
} from "@/modules/mind"
import {
	serializeConfig,
	importConfigAndRestart,
	configHealth,
} from "@/modules/config"
import { listModels, startInstall, getModelJob } from "@/modules/model-manager"
import type {
	PostChatBodyType,
	PostChatResponseType,
	GetAudioRouteType,
	GetSyncQueryType,
	GetSyncResponseType,
	PostVoiceBodyType,
	PostVoiceResponseType,
	PostVoiceTimingsType,
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
	requestTextToVoiceReply,
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

const computeTimings = (
	stages: Partial<Record<RequestVoiceReplyStage, number>>,
): PostVoiceTimingsType => {
	const end = stages.tts ?? stages.llm ?? stages.stt ?? 0
	return {
		sttMs: stages.stt ?? 0,
		llmMs: (stages.llm ?? 0) - (stages.stt ?? 0),
		ttsMs: stages.tts != null ? stages.tts - (stages.llm ?? 0) : 0,
		ttfaMs: stages.firstAudioChunk ?? 0,
		totalMs: end,
	}
}

export const handlePostChat = async (
	domia: DomiaType,
	body: PostChatBodyType,
): Promise<PostChatResponseType> => {
	const { text, speak } = postChatBodySchema.parse(body)
	try {
		if (speak) {
			const stages: Partial<Record<RequestVoiceReplyStage, number>> = {}
			const result = await requestTextToVoiceReply(domia, text, {
				onStage: (stage, elapsedMs) => {
					stages[stage] = elapsedMs
				},
			})
			const timings = computeTimings(stages)
			await updateInteraction({
				id: result.interactionId,
				ttfaMs: timings.ttfaMs,
				totalMs: timings.totalMs,
			})
			const audioUrl = result.ttsFilePath
				? (registerAudioForServing(result.interactionId, result.ttsFilePath),
					`/audio/${result.interactionId}`)
				: null
			return {
				interactionId: result.interactionId,
				reply: result.reply,
				audioUrl,
				timings,
			}
		}

		const startedAt = Date.now()
		const { reply, interactionId } = await requestTextReply(domia, text)
		const totalMs = Date.now() - startedAt
		await updateInteraction({ id: interactionId, totalMs })
		return {
			interactionId,
			reply,
			timings: { sttMs: 0, llmMs: totalMs, ttsMs: 0, ttfaMs: 0, totalMs },
		}
	} catch (err) {
		httpServerLogger.error("Chat request failed", { domiaId: domia.id, err })
		throw err
	}
}

const ALLOWED_VOICE_DIRS = [resolve(RECORDINGS_DIR), resolve("tmp")]

const isAllowedVoiceFilePath = (filePath: string): boolean => {
	const resolved = resolve(filePath)
	return ALLOWED_VOICE_DIRS.some((dir) => resolved.startsWith(dir + sep))
}

export const handlePostVoice = async (
	domia: DomiaType,
	body: PostVoiceBodyType,
): Promise<PostVoiceResponseType> => {
	const { filePath, audioBase64, speak } = postVoiceBodySchema.parse(body)
	let archivedInputPath: string | null = null
	if (audioBase64) {
		archivedInputPath = join(RECORDINGS_DIR, `voice-${generateUuid()}.wav`)
		await writeFile(archivedInputPath, Buffer.from(audioBase64, "base64"))
	}
	if (filePath && !isAllowedVoiceFilePath(filePath)) {
		throw new Error(
			"filePath must live under the node's recordings or tmp directory",
		)
	}
	const audioPath = archivedInputPath ?? (filePath as string)
	try {
		const stages: Partial<Record<RequestVoiceReplyStage, number>> = {}
		const result = await requestVoiceReply(domia, audioPath, {
			speak,
			onStage: (stage, elapsedMs) => {
				stages[stage] = elapsedMs
			},
		})
		const timings = computeTimings(stages)
		await updateInteraction({
			id: result.interactionId,
			ttfaMs: timings.ttfaMs,
			totalMs: timings.totalMs,
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
			timings,
		}
	} catch (err) {
		httpServerLogger.error("Voice request failed", { domiaId: domia.id, err })
		throw err
	}
}

export const handleGetMind = async (domia: DomiaType) => {
	return { mind: serializeMind(domia) }
}

export const handleGetConfig = async (domia: DomiaType) => {
	return { config: serializeConfig(domia) }
}

export const handlePostConfig = async (
	domia: DomiaType,
	body: unknown,
	reply: FastifyReply,
) => {
	try {
		return await importConfigAndRestart(domia, body)
	} catch (err) {
		httpServerLogger.error("Import config failed", { domiaId: domia.id, err })
		if (err instanceof ZodError)
			return reply
				.code(400)
				.send({ error: "Invalid config bundle", issues: err.issues })
		return reply.code(500).send({ error: "Config import failed" })
	}
}

export const handleGetConfigHealth = async (domia: DomiaType) => {
	return { health: configHealth(domia) }
}

export const handleGetModels = async (domia: DomiaType) => {
	const ollamaHost = domia.llmModelConfig?.baseUrl ?? DEFAULT_OLLAMA_HOST
	return { models: await listModels(ollamaHost) }
}

export const handlePostModelInstall = async (
	domia: DomiaType,
	body: unknown,
	reply: FastifyReply,
) => {
	const ollamaHost = domia.llmModelConfig?.baseUrl ?? DEFAULT_OLLAMA_HOST
	try {
		return { job: startInstall(body, ollamaHost) }
	} catch (err) {
		httpServerLogger.error("Model install request failed", { err })
		return reply.code(400).send({ error: "Invalid model install spec" })
	}
}

export const handleGetModelJob = async (id: string, reply: FastifyReply) => {
	const job = getModelJob(id)
	if (!job) return reply.code(404).send({ error: "Job not found" })
	return { job }
}

export const handleRestart = async () => {
	requestRestart()
	return { restarting: true }
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
		...interactions.map((r) => r.updatedAt),
		...emotionEvents.map((r) => r.createdAt),
		...facts.map((r) => r.updatedAt),
		...sessions.map((r) => r.updatedAt),
	].filter((s): s is string => Boolean(s))
	const nextCursor = stamps.length
		? stamps.reduce((a, b) => (a > b ? a : b))
		: since

	return { interactions, sessions, emotionEvents, facts, nextCursor }
}

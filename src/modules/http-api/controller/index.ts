import { createReadStream, existsSync } from "fs"
import { ZodError } from "zod"
import { writeFile } from "fs/promises"
import { join, resolve, sep } from "path"
import { generateUuid } from "@/utils"
import { DEFAULT_OLLAMA_HOST } from "@/db"
import { env } from "@/config"
import {
	type DomiaType,
	getActiveDomias,
	getDomia,
	retireDomia,
	reactivateDomia,
	invalidateOwnDomia,
	getRedactedSatellitesForDomia,
	upsertSatellite,
	deleteSatellite,
} from "@/modules/core"
import { publishIdentityState } from "@/modules/heartbeat-manager"
import { discoverEsphome } from "@/modules/satellite-discovery"
import {
	DEFAULT_SATELLITE_PORT,
	DEFAULT_SATELLITE_PROTOCOL,
	DEFAULT_SATELLITE_PORT_BY_PROTOCOL,
} from "@/db"
import { initialize, DEFAULT_CONFIG_VALUES } from "@/modules/config-engine"
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
	PostSpeakBodyType,
	PostSpeakResponseType,
	PostImportMindBodyType,
} from "../types"
import {
	postChatBodySchema,
	postVoiceBodySchema,
	postSpeakBodySchema,
	postIntercomBodySchema,
	postImportMindBodySchema,
	postIdentityBodySchema,
	postSatelliteBodySchema,
	getSyncQuerySchema,
	getAudioQuerySchema,
} from "../schemas"
import {
	requestTextReply,
	requestTextToVoiceReply,
	getAudioFilePath,
	registerAudioForServing,
	requestVoiceReply,
	speak,
	speakActiveRoom,
	speakBroadcast,
	getAllPresence,
	startIntercom,
	stopIntercom,
	abortActiveTurn,
	type RequestVoiceReplyStage,
	type SpeakBroadcastResultType,
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

export const handlePostSpeak = async (
	domia: DomiaType,
	body: PostSpeakBodyType,
): Promise<PostSpeakResponseType | SpeakBroadcastResultType> => {
	const { text, broadcast, active } = postSpeakBodySchema.parse(body)
	if (broadcast) {
		const result = await speakBroadcast(text)
		httpServerLogger.info(`📢 /speak broadcast → ${result.delivered.length}`, {
			delivered: result.delivered,
		})
		return result
	}
	if (active) {
		const result = await speakActiveRoom(text)
		httpServerLogger.info(`📢 /speak active → ${result.target}`, {
			delivered: result.delivered,
		})
		return result
	}
	const result = await speak(domia, text)
	httpServerLogger.info(`📢 /speak → ${result.target}`, {
		domiaKey: domia.domiaKey,
		delivered: result.delivered,
	})
	return result
}

export const handlePostTurnCancel = (domia: DomiaType) => {
	const aborted = abortActiveTurn(domia.id, "console-stop")
	httpServerLogger.info(`🛑 /turn/cancel → ${aborted ? "aborted" : "no-op"}`, {
		domiaKey: domia.domiaKey,
	})
	return { aborted }
}

export const handleGetPresence = () => {
	return { presence: getAllPresence() }
}

export const handlePostIntercom = async (body: unknown) => {
	const { from, to, stop } = postIntercomBodySchema.parse(body)
	if (stop || !to) {
		const stopped = await stopIntercom(from)
		return { intercom: "stopped" as const, from, stopped }
	}
	const started = await startIntercom(from, to, {
		sampleRate: 16000,
		channels: 1,
	})
	return {
		intercom: started ? ("started" as const) : ("failed" as const),
		from,
		to,
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

const slugifyDomiaKey = (name: string): string =>
	`DOMIA_${name
		.normalize("NFKD")
		.replace(/[^A-Za-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase()}`

const roleOf = (isHosted: boolean, isPrincipal: boolean): string =>
	isPrincipal ? "principal" : isHosted ? "hosted" : "peer"

export const handleGetIdentities = async () => {
	const domias = (await getActiveDomias()).filter(
		(domia): domia is DomiaType => !!domia,
	)
	return {
		identities: domias.map((domia) => {
			const isPrincipal = domia.domiaKey === env.DOMIA_KEY
			return {
				domiaKey: domia.domiaKey,
				name: domia.name,
				isHosted: domia.isHosted,
				isPrincipal,
				role: roleOf(domia.isHosted, isPrincipal),
			}
		}),
	}
}

export const handlePostIdentity = async (
	body: unknown,
	reply: FastifyReply,
) => {
	const parsed = postIdentityBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid identity body" })
	}
	const { name, domiaKey } = parsed.data
	const baseKey = domiaKey ?? slugifyDomiaKey(name)
	let key = baseKey
	const existing = await getDomia(key)
	if (existing) {
		if (!existing.isActive || !existing.isHosted) {
			await reactivateDomia(key)
			invalidateOwnDomia(key)
			await publishIdentityState(key)
			requestRestart()
			return {
				identity: { domiaKey: key, name: existing.name },
				restarting: true,
				restored: true,
			}
		}
		if (domiaKey) {
			return reply.code(409).send({ error: `identity already exists: ${key}` })
		}
		key = `${baseKey}_${generateUuid().slice(0, 6).toUpperCase()}`
	}
	await initialize(
		{ ...DEFAULT_CONFIG_VALUES, name, domiaKey: key },
		{ isHosted: true },
	)
	requestRestart()
	return { identity: { domiaKey: key, name }, restarting: true }
}

export const handleDeleteIdentity = async (
	domiaKey: string,
	reply: FastifyReply,
) => {
	if (domiaKey === env.DOMIA_KEY) {
		return reply
			.code(409)
			.send({ error: "principal identity cannot be removed" })
	}
	const existing = await getDomia(domiaKey)
	if (!existing) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	await retireDomia(domiaKey)
	invalidateOwnDomia(domiaKey)
	await publishIdentityState(domiaKey)
	requestRestart()
	return { removed: true, restarting: true }
}

export const handleDiscoverSatellites = async () => ({
	satellites: await discoverEsphome(),
})

export const handleGetSatellites = async (
	domiaKey: string | undefined,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	return { satellites: await getRedactedSatellitesForDomia(domia.id) }
}

export const handlePostSatellite = async (
	domiaKey: string | undefined,
	body: unknown,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({
			error: `satellites can only be bound to a hosted identity (room): ${domiaKey}`,
		})
	}
	const parsed = postSatelliteBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid satellite body" })
	}
	const { satelliteId, name, host, port, encryptionKey, protocol } = parsed.data
	const resolvedProtocol = protocol ?? DEFAULT_SATELLITE_PROTOCOL
	await upsertSatellite(domia.id, {
		id: generateUuid(),
		satelliteId,
		name: name ?? null,
		host,
		port:
			port ??
			DEFAULT_SATELLITE_PORT_BY_PROTOCOL[resolvedProtocol] ??
			DEFAULT_SATELLITE_PORT,
		encryptionKey: encryptionKey ?? null,
		protocol: resolvedProtocol,
	})
	invalidateOwnDomia(domiaKey)
	requestRestart()
	return { bound: true, restarting: true }
}

export const handleDeleteSatellite = async (
	domiaKey: string | undefined,
	satelliteId: string,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	await deleteSatellite(domia.id, satelliteId)
	invalidateOwnDomia(domiaKey)
	requestRestart()
	return { removed: true, restarting: true }
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

import { createReadStream, existsSync } from "fs"
import { ZodError } from "zod"
import { writeFile, mkdir, copyFile } from "fs/promises"
import { join, resolve, sep } from "path"
import { generateUuid, writeWavToTemp } from "@/utils"
import { DEFAULT_OLLAMA_HOST } from "@/db"
import { env } from "@/config"
import {
	type DomiaType,
	getActiveDomias,
	getHostedDomias,
	getDomia,
	retireDomia,
	reactivateDomia,
	invalidateOwnDomia,
	getRedactedSatellitesForDomia,
	getActiveSatellites,
	upsertSatellite,
	deleteSatellite,
	setSatelliteDesiredWakeWords,
	setSatelliteDesiredNumber,
	setSatelliteFollowUp,
	getOwnDomia,
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
	recordAnnouncement,
	getAnnouncementById,
	getAnnouncementsSince,
} from "@/modules/session-manager"
import { getEmotionEventsSince } from "@/modules/emotion-engine"
import { getFactsSince } from "@/modules/memory"
import {
	serializeMind,
	importMind,
	listTemplates,
	activateTemplate,
} from "@/modules/mind"
import { serializeConfig, configHealth } from "@/modules/config"
import { applyConfig, reloadSubsystem } from "@/modules/config-apply"
import {
	bootHostedIdentity,
	teardownHostedIdentity,
} from "@/setups/hosted-identities"
import { reloadSatelliteClientsForDomia } from "@/setups/satellite-clients"
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
	PersistAnnouncementOptsType,
} from "../types"
import {
	postChatBodySchema,
	postVoiceBodySchema,
	postAnnounceAudioBodySchema,
	postSpeakBodySchema,
	postIntercomBodySchema,
	postImportMindBodySchema,
	postIdentityBodySchema,
	postSatelliteBodySchema,
	postSatelliteWakeWordsBodySchema,
	postSatelliteNumberBodySchema,
	postSatelliteFollowUpBodySchema,
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
	announceAudio,
	renderAnnouncementUrl,
	getSatelliteControl,
	canDeliverIntercom,
	canDeliverBroadcast,
	getAllPresence,
	getPresence,
	startDuplexIntercom,
	stopIntercom,
	stopIntercomTo,
	abortActiveTurn,
	type RequestVoiceReplyStage,
	type SpeakBroadcastResultType,
	type SpeakResultType,
} from "@/modules/core-bus"
import { runSTT } from "@/modules/stt-engine"
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
	let filePath =
		kind === "tts" || kind === "announce"
			? getAudioFilePath(interactionId)
			: null
	if (!filePath && kind === "announce") {
		const row = await getAnnouncementById(interactionId)
		filePath = row?.audioPath ?? null
	}
	if (!filePath && kind !== "announce") {
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

const persistAnnouncement = async (
	domia: DomiaType,
	opts: PersistAnnouncementOptsType,
): Promise<void> => {
	try {
		const id = opts.result.audioId ?? generateUuid()
		let audioPath: string | null = null
		if (opts.result.audioPath) {
			try {
				await mkdir(RECORDINGS_DIR, { recursive: true })
				const stablePath = join(RECORDINGS_DIR, `announce-${id}.wav`)
				await copyFile(opts.result.audioPath, stablePath)
				audioPath = stablePath
			} catch {
				audioPath = null
			}
		}
		await recordAnnouncement({
			id,
			domiaId: domia.id,
			broadcastId: opts.broadcastId,
			text: opts.text,
			kind: opts.kind,
			delivery: opts.delivery,
			target: opts.result.target,
			delivered: opts.result.delivered,
			audioPath,
		})
	} catch (err) {
		httpServerLogger.warn("failed to record announcement", {
			domiaKey: domia.domiaKey,
			err,
		})
	}
}

export const handlePostAnnounceAudio = async (
	domia: DomiaType,
	body: unknown,
) => {
	const { audioBase64, mode, broadcastId } =
		postAnnounceAudioBodySchema.parse(body)
	const wav = Buffer.from(audioBase64, "base64")
	const bId = broadcastId ?? generateUuid()

	if (mode === "transcribe") {
		const filePath = await writeWavToTemp(wav, generateUuid(), "announce")
		const transcript = await runSTT(domia, filePath)
		const result = await speak(domia, transcript)
		await persistAnnouncement(domia, {
			broadcastId: bId,
			text: transcript,
			kind: "audio",
			delivery: "domia-voice",
			result,
		})
		httpServerLogger.info(`📢 /announce-audio transcribe → ${result.target}`, {
			domiaKey: domia.domiaKey,
		})
		return { mode, transcript, ...result }
	}

	const result = await announceAudio(domia, wav)
	await persistAnnouncement(domia, {
		broadcastId: bId,
		text: "",
		kind: "audio",
		delivery: "original",
		result,
	})
	httpServerLogger.info(`📢 /announce-audio voice → ${result.target}`, {
		domiaKey: domia.domiaKey,
	})
	return { mode, ...result }
}

export const handlePostSpeak = async (
	domia: DomiaType,
	body: PostSpeakBodyType,
): Promise<PostSpeakResponseType | SpeakBroadcastResultType> => {
	const { text, broadcast, active, broadcastId } =
		postSpeakBodySchema.parse(body)
	if (broadcast) {
		const items = await speakBroadcast(text)
		const bId = broadcastId ?? generateUuid()
		for (const item of items) {
			await persistAnnouncement(item.domia, {
				broadcastId: bId,
				text,
				kind: "text",
				delivery: "domia-voice",
				result: item.result,
			})
		}
		const delivered = items
			.filter((i) => i.result.delivered)
			.map((i) => i.domia.domiaKey)
		httpServerLogger.info(`📢 /speak broadcast → ${delivered.length}`, {
			delivered,
		})
		return { delivered }
	}
	if (active) {
		const item = await speakActiveRoom(text)
		const result: SpeakResultType = item?.result ?? {
			delivered: false,
			target: "none",
		}
		if (item) {
			await persistAnnouncement(item.domia, {
				broadcastId: broadcastId ?? generateUuid(),
				text,
				kind: "text",
				delivery: "domia-voice",
				result: item.result,
			})
		}
		httpServerLogger.info(`📢 /speak active → ${result.target}`, {
			delivered: result.delivered,
		})
		return result
	}
	const result = await speak(domia, text)
	await persistAnnouncement(domia, {
		broadcastId: broadcastId ?? generateUuid(),
		text,
		kind: "text",
		delivery: "domia-voice",
		result,
	})
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

export const handleGetPresence = async () => {
	const byKey = new Map(getAllPresence().map((e) => [e.domiaKey, e]))
	const hosted = await getHostedDomias()
	const presence = await Promise.all(
		hosted.map(async ({ domiaKey }) => {
			const entry = byKey.get(domiaKey) ?? {
				domiaKey,
				status: "idle" as const,
				lastActiveAt: null,
				satellites: [],
			}
			return {
				...entry,
				canIntercom: await canDeliverIntercom(domiaKey),
				canBroadcast: await canDeliverBroadcast(domiaKey),
			}
		}),
	)
	return { presence }
}

export const handlePostIntercom = async (body: unknown) => {
	const { from, to, stop } = postIntercomBodySchema.parse(body)
	if (stop || !to) {
		const stopped = await stopIntercom(from)
		await stopIntercomTo(from)
		return { intercom: "stopped" as const, from, stopped }
	}
	const started = await startDuplexIntercom(from, to, {
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
		return await applyConfig(domia, body)
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
			const booted = await bootHostedIdentity(key)
			if (booted) await reloadSatelliteClientsForDomia(booted)
			await publishIdentityState(key)
			return {
				identity: { domiaKey: key, name: existing.name },
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
	await bootHostedIdentity(key)
	await publishIdentityState(key)
	return { identity: { domiaKey: key, name } }
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
	await teardownHostedIdentity(domiaKey)
	return { removed: true }
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
	const boundElsewhere = (await getActiveSatellites()).find(
		(row) => row.satelliteId === satelliteId && row.domiaId !== domia.id,
	)
	if (boundElsewhere) {
		return reply.code(409).send({
			error: `satellite ${satelliteId} is already bound to another Domia (${boundElsewhere.domia.domiaKey})`,
		})
	}
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
	const apply = await reloadSubsystem("satellites", domiaKey)
	return { bound: true, apply }
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
	const apply = await reloadSubsystem("satellites", domiaKey)
	return { removed: true, apply }
}

const SATELLITE_TEST_PHRASE =
	"Hi, this is a test from Domia. If you can hear me, your speaker is working."

export const handleSetSatelliteWakeWords = async (
	domiaKey: string | undefined,
	satelliteId: string,
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
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	const parsed = postSatelliteWakeWordsBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid wake words body" })
	}
	const updated = await setSatelliteDesiredWakeWords(
		domia.id,
		satelliteId,
		parsed.data.wakeWords,
	)
	if (updated.length === 0) {
		return reply
			.code(404)
			.send({ error: `satellite not bound to ${domiaKey}: ${satelliteId}` })
	}
	invalidateOwnDomia(domiaKey)
	const control = getSatelliteControl(domiaKey, satelliteId)
	control?.setWakeWords(parsed.data.wakeWords)
	return { applied: true, live: !!control }
}

export const handleSetSatelliteNumber = async (
	domiaKey: string | undefined,
	satelliteId: string,
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
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	const parsed = postSatelliteNumberBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid number body" })
	}
	const { entityId, value } = parsed.data
	const entity = getPresence(domiaKey)
		?.satellites.find((s) => s.satelliteId === satelliteId)
		?.numberEntities.find((n) => n.id === entityId)
	if (entity) {
		if (
			(entity.min != null && value < entity.min) ||
			(entity.max != null && value > entity.max)
		) {
			return reply.code(400).send({
				error: `value ${value} out of range [${entity.min}, ${entity.max}] for ${entityId}`,
			})
		}
	} else {
		httpServerLogger.warn("setting unvalidated satellite number (offline?)", {
			domiaKey,
			satelliteId,
			entityId,
		})
	}
	const updated = await setSatelliteDesiredNumber(
		domia.id,
		satelliteId,
		entityId,
		value,
	)
	if (updated.length === 0) {
		return reply
			.code(404)
			.send({ error: `satellite not bound to ${domiaKey}: ${satelliteId}` })
	}
	invalidateOwnDomia(domiaKey)
	const control = getSatelliteControl(domiaKey, satelliteId)
	control?.setNumber?.(entityId, value)
	return { applied: true, live: !!control?.setNumber }
}

export const handleSetSatelliteFollowUp = async (
	domiaKey: string | undefined,
	satelliteId: string,
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
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	const parsed = postSatelliteFollowUpBodySchema.safeParse(body)
	if (!parsed.success) {
		return reply.code(400).send({ error: "Invalid follow-up body" })
	}
	const updated = await setSatelliteFollowUp(
		domia.id,
		satelliteId,
		parsed.data.enabled,
	)
	if (updated.length === 0) {
		return reply
			.code(404)
			.send({ error: `satellite not bound to ${domiaKey}: ${satelliteId}` })
	}
	invalidateOwnDomia(domiaKey)
	const control = getSatelliteControl(domiaKey, satelliteId)
	control?.setFollowUp?.(parsed.data.enabled)
	return { applied: true, live: !!control?.setFollowUp }
}

export const handleTestSatelliteSpeaker = async (
	domiaKey: string | undefined,
	satelliteId: string,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getOwnDomia(domiaKey).catch(() => null)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	const control = getSatelliteControl(domiaKey, satelliteId)
	if (!control) {
		return reply.code(409).send({ error: "satellite not connected" })
	}
	const url = await renderAnnouncementUrl(domia, SATELLITE_TEST_PHRASE)
	if (!url) {
		return reply.code(503).send({ error: "TTS unavailable" })
	}
	control.announce(url)
	httpServerLogger.info(`🔊 /satellites/${satelliteId}/test-speaker`, {
		domiaKey,
		delivered: true,
	})
	return { delivered: true, target: "satellite" }
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

	const [interactions, sessions, emotionEvents, facts, announcements] =
		await Promise.all([
			getInteractionsSince(domiaId, since, limit),
			getSessionsSince(domiaId, since, limit),
			getEmotionEventsSince(domiaId, since, limit),
			getFactsSince(domiaId, since, limit),
			getAnnouncementsSince(domiaId, since, limit),
		])

	const maxTs = (stamps: (string | null)[]): string =>
		stamps.reduce<string>((m, s) => (s && s > m ? s : m), "")

	const streams = [
		{
			max: maxTs(interactions.map((r) => r.updatedAt)),
			full: interactions.length >= limit,
		},
		{
			max: maxTs(sessions.map((r) => r.updatedAt)),
			full: sessions.length >= limit,
		},
		{
			max: maxTs(emotionEvents.map((r) => r.createdAt)),
			full: emotionEvents.length >= limit,
		},
		{ max: maxTs(facts.map((r) => r.updatedAt)), full: facts.length >= limit },
		{
			max: maxTs(announcements.map((r) => r.updatedAt)),
			full: announcements.length >= limit,
		},
	]
	const fullMaxes = streams.filter((s) => s.full && s.max).map((s) => s.max)
	const allMaxes = streams.map((s) => s.max).filter(Boolean)
	const nextCursor = fullMaxes.length
		? fullMaxes.reduce((a, b) => (a < b ? a : b))
		: allMaxes.length
			? allMaxes.reduce((a, b) => (a > b ? a : b))
			: since

	return {
		interactions,
		sessions,
		emotionEvents,
		facts,
		announcements,
		nextCursor,
	}
}

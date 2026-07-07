import { writeFile, mkdir, copyFile } from "fs/promises"
import { join, resolve, sep } from "path"
import {
	generateUuid,
	writeWavToTemp,
	httpServerLogger,
	setTraceContext,
} from "@/utils"
import { type DomiaType } from "@/modules/core"
import { RECORDINGS_DIR } from "@/modules/audio-capture/constants"
import {
	updateInteraction,
	recordAnnouncement,
} from "@/modules/session-manager"
import type {
	PostChatBodyType,
	PostChatResponseType,
	PostVoiceBodyType,
	PostVoiceResponseType,
	PostVoiceTimingsType,
	PostSpeakBodyType,
	PostSpeakResponseType,
	PersistAnnouncementOptsType,
} from "../types"
import {
	postChatBodySchema,
	postVoiceBodySchema,
	postAnnounceAudioBodySchema,
	postSpeakBodySchema,
} from "../schemas"
import {
	requestTextReply,
	requestTextToVoiceReply,
	registerAudioForServing,
	requestVoiceReply,
	speak,
	speakActiveRoom,
	speakBroadcast,
	announceAudio,
	abortActiveTurn,
	type RequestVoiceReplyStage,
	type SpeakBroadcastResultType,
	type SpeakResultType,
} from "@/modules/core-bus"
import { runSTT } from "@/modules/stt-engine"

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
	setTraceContext({ originDomiaKey: domia.domiaKey })
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
	setTraceContext({ originDomiaKey: domia.domiaKey })
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

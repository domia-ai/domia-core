import { z } from "zod"

import { SATELLITE_PROTOCOL_ENUM_VALUES } from "@/db"

export const postIdentityBodySchema = z.object({
	name: z.string().trim().min(1).max(80),
	domiaKey: z.string().trim().min(1).max(200).optional(),
})

export const postSatelliteBodySchema = z.object({
	satelliteId: z.string().trim().min(1).max(200),
	name: z.string().trim().min(1).max(120).optional(),
	host: z.string().trim().min(1).max(200),
	port: z.coerce.number().int().positive().max(65535).optional(),
	encryptionKey: z.string().trim().min(1).max(200).optional(),
	protocol: z.enum(SATELLITE_PROTOCOL_ENUM_VALUES).optional(),
})

export const postSatelliteWakeWordsBodySchema = z.object({
	wakeWords: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
})

export const postSatelliteNumberBodySchema = z.object({
	entityId: z.string().trim().min(1).max(200),
	value: z.number().finite(),
})

export const postSatelliteFollowUpBodySchema = z.object({
	enabled: z.boolean(),
})

export const postSatelliteVolumeBodySchema = z.object({
	volume: z.number().min(0).max(1),
})

export const postSatelliteTimerBodySchema = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	seconds: z.number().int().positive().max(86400),
})

export const postChatBodySchema = z.object({
	text: z
		.string()
		.min(1, "Body must include a non-empty 'text' string.")
		.trim(),
	speak: z.boolean().optional().default(false),
})

export const postVoiceBodySchema = z
	.object({
		filePath: z.string().trim().min(1).optional(),
		audioBase64: z.string().min(1).optional(),
		speak: z.boolean().optional().default(true),
	})
	.refine((b) => Boolean(b.filePath || b.audioBase64), {
		message: "Body must include a non-empty 'filePath' or 'audioBase64'.",
	})

export const postAnnounceAudioBodySchema = z.object({
	domiaKey: z.string().trim().min(1).optional(),
	audioBase64: z.string().min(1),
	mode: z.enum(["voice", "transcribe"]).optional().default("voice"),
	broadcastId: z.string().trim().min(1).optional(),
})

export const postSpeakBodySchema = z.object({
	domiaKey: z.string().trim().min(1).optional(),
	broadcast: z.boolean().optional().default(false),
	active: z.boolean().optional().default(false),
	text: z
		.string()
		.min(1, "Body must include a non-empty 'text' string.")
		.trim(),
	broadcastId: z.string().trim().min(1).optional(),
})

export const postIntercomBodySchema = z.object({
	from: z.string().trim().min(1),
	to: z.string().trim().min(1).optional(),
	stop: z.boolean().optional().default(false),
})

export const postImportMindBodySchema = z.object({
	mind: z.unknown(),
})

export const getSyncQuerySchema = z.object({
	since: z.string().optional().default(""),
	limit: z.coerce.number().int().positive().max(1000).optional().default(200),
})

export const getAudioQuerySchema = z.object({
	kind: z.enum(["input", "tts", "announce"]).default("tts"),
})

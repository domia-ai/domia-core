import { z } from "zod"

import {
	SATELLITE_PROTOCOL_ENUM_VALUES,
	PROACTIVE_VERB_ENUM_VALUES,
	PROACTIVE_IMPORTANCE_ENUM_VALUES,
	PROACTIVE_TARGET_KIND_ENUM_VALUES,
	PROACTIVE_SCHEDULE_STATUS_ENUM_VALUES,
} from "@/db/constants"
import { BENCH_TURNS_MAX } from "@/modules/bench/constants"

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
	livekitApiKey: z.string().trim().min(1).max(200).optional(),
	livekitApiSecret: z.string().trim().min(1).max(200).optional(),
	livekitRoom: z.string().trim().min(1).max(200).optional(),
})

export const postSatelliteWakeWordsBodySchema = z.object({
	wakeWords: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
})

export const postSatelliteNumberBodySchema = z.object({
	entityId: z.string().trim().min(1).max(200),
	value: z.number(),
})

export const postSatelliteFollowUpBodySchema = z.object({
	enabled: z.boolean(),
})

export const postSatelliteVolumeBodySchema = z.object({
	volume: z.number().min(0).max(1),
})

const clockSchema = z.string().regex(/^\d{1,2}:\d{2}$/, "expected HH:MM")

export const postScheduleBodySchema = z
	.object({
		name: z.string().trim().min(1).max(120),
		text: z.string().trim().min(1).max(600).nullish(),
		templateKey: z.string().trim().min(1).max(80).nullish(),
		templateParams: z.record(z.string(), z.string()).nullish(),
		verb: z.enum(PROACTIVE_VERB_ENUM_VALUES).optional(),
		importance: z.enum(PROACTIVE_IMPORTANCE_ENUM_VALUES).optional(),
		targetKind: z.enum(PROACTIVE_TARGET_KIND_ENUM_VALUES).optional(),
		targetSatelliteId: z.string().trim().min(1).max(200).nullish(),
		actionTool: z.string().trim().min(1).max(200).nullish(),
		actionArgs: z.record(z.string(), z.unknown()).nullish(),
		personId: z.string().trim().min(1).max(200).nullish(),
		dueAt: z.iso.datetime({ offset: true }).optional(),
		inMs: z.number().int().nonnegative().max(31_536_000_000).optional(),
		repeatEveryMs: z.number().int().positive().max(31_536_000_000).nullish(),
		repeatDailyAt: clockSchema.nullish(),
	})
	.refine((b) => b.dueAt !== undefined || b.inMs !== undefined, {
		message: "Body must include 'dueAt' (ISO) or 'inMs'.",
	})
	.refine((b) => b.targetKind !== "satellite" || !!b.targetSatelliteId, {
		message: "targetKind 'satellite' requires 'targetSatelliteId'.",
	})
	.refine((b) => !(b.repeatEveryMs && b.repeatDailyAt), {
		message: "Use either 'repeatEveryMs' or 'repeatDailyAt', not both.",
	})

export const getScheduleQuerySchema = z.object({
	domiaKey: z.string().optional(),
	status: z
		.string()
		.refine(
			(s) =>
				s
					.split(",")
					.every((v) =>
						(
							PROACTIVE_SCHEDULE_STATUS_ENUM_VALUES as readonly string[]
						).includes(v.trim()),
					),
			"unknown status",
		)
		.optional(),
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

export const postKnowledgeBodySchema = (maxChars: number) =>
	z.object({
		id: z.string().trim().min(1).max(200).optional(),
		title: z.string().trim().min(1).max(200),
		content: z.string().trim().min(1).max(maxChars),
		keywords: z.array(z.string().trim().min(1).max(120)).max(64).nullish(),
		priority: z.number().int().min(-1000).max(1000).optional(),
		isActive: z.boolean().optional(),
	})

export const postImportMindBodySchema = z.object({
	mind: z.unknown(),
})

export const getSyncQuerySchema = z.object({
	since: z.string().optional().default(""),
	turnSince: z.string().optional().default(""),
	turnId: z.string().optional().default(""),
	factsSince: z.string().optional().default(""),
	factsId: z.string().optional().default(""),
	limit: z.coerce.number().int().positive().max(1000).optional().default(200),
})

export const getAudioQuerySchema = z.object({
	kind: z.enum(["input", "tts", "announce"]).default("tts"),
})

export const postBenchRunBodySchema = z.object({
	turns: z.number().int().min(1).max(BENCH_TURNS_MAX).optional(),
})

export const MESH_ROTATE_ACTIONS = [
	"status",
	"restart-grace",
	"end-grace",
] as const

export const postMeshRotateBodySchema = z.object({
	action: z.enum(MESH_ROTATE_ACTIONS).default("status"),
})

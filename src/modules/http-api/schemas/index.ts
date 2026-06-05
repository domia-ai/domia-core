import { z } from "zod"

export const postChatBodySchema = z.object({
	text: z
		.string()
		.min(1, "Body must include a non-empty 'text' string.")
		.trim(),
})

export const postVoiceBodySchema = z.object({
	filePath: z
		.string()
		.min(1, "Body must include a non-empty 'filePath' string.")
		.trim(),
})

export const postImportMindBodySchema = z.object({
	mind: z.unknown(),
})

export const getSyncQuerySchema = z.object({
	since: z.string().optional().default(""),
	limit: z.coerce.number().int().positive().max(1000).optional().default(200),
})

export const getAudioQuerySchema = z.object({
	kind: z.enum(["input", "tts"]).default("tts"),
})

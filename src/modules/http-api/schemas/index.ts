import { z } from "zod"

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

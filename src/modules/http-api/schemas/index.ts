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

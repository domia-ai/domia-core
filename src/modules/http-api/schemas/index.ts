import { z } from "zod"

export const postChatBodySchema = z.object({
	text: z
		.string()
		.min(1, "Body must include a non-empty 'text' string.")
		.trim(),
})

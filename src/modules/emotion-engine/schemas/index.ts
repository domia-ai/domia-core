import { z } from "zod"

export const emotionSchema = z.object({
	joy: z.number().min(-1).max(1),
	sadness: z.number().min(-1).max(1),
	anger: z.number().min(-1).max(1),
	fear: z.number().min(-1).max(1),
	trust: z.number().min(-1).max(1),
	disgust: z.number().min(-1).max(1),
	anticipation: z.number().min(-1).max(1),
	surprise: z.number().min(-1).max(1),
})

export const emotionPartialSchema = emotionSchema.partial()

export const userEmotionSchema = z.object({
	primary: z.string().min(1).max(40),
	intensity: z.number().min(0).max(1),
	note: z.string().max(120).nullish(),
})

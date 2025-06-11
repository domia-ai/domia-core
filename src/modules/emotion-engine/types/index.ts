import { z } from "zod"

import {
	emotionSchema,
	emotionPartialSchema,
	emotionEventSchema,
} from "../schemas"

export type EmotionType = z.infer<typeof emotionSchema>
export type EmotionPartialType = z.infer<typeof emotionPartialSchema>
export type EmotionEventType = z.infer<typeof emotionEventSchema>

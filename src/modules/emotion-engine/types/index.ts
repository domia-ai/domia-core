import { z } from "zod"

import {
	emotionSchema,
	emotionPartialSchema,
	userEmotionSchema,
} from "../schemas"

export type EmotionType = z.infer<typeof emotionSchema>
export type EmotionPartialType = z.infer<typeof emotionPartialSchema>
export type UserEmotionType = z.infer<typeof userEmotionSchema>

export type UserReactionMatrixType = Record<
	keyof EmotionType,
	EmotionPartialType
>

export type EmotionAppraisalType = {
	delta: EmotionPartialType
	cause: string
}

export type EmotionTrajectoryEntryType = {
	cause: string
	delta: EmotionPartialType
}

export type MoodProsodyType = {
	speedMult: number
	pitchMult: number
	silenceScaleMult: number
}

export type ProsodyVoiceType = {
	speed: number
	silenceScale: number
	pitch: number
}

import { PERSONALITY_ENUM, type PersonalityEnumType } from "@/db"

import { type EmotionType } from "../types"

export const DEFAULT_PERSONALITY = PERSONALITY_ENUM.NEUTRAL
export const NEUTRAL_EMOTION_PRESET: EmotionType = {
	joy: 0.4,
	sadness: 0.1,
	anger: 0.05,
	fear: 0.2,
	trust: 0.5,
	disgust: 0.05,
	anticipation: 0.5,
	surprise: 0.3,
}
export const OPTIMISTIC_EMOTION_PRESET: EmotionType = {
	joy: 0.8,
	sadness: 0.05,
	anger: 0.05,
	fear: 0.1,
	trust: 0.7,
	disgust: 0.05,
	anticipation: 0.6,
	surprise: 0.4,
}
export const CALM_EMOTION_PRESET: EmotionType = {
	joy: 0.5,
	sadness: 0.1,
	anger: 0.02,
	fear: 0.15,
	trust: 0.6,
	disgust: 0.05,
	anticipation: 0.4,
	surprise: 0.2,
}
export const ANALYTICAL_EMOTION_PRESET: EmotionType = {
	joy: 0.3,
	sadness: 0.1,
	anger: 0.05,
	fear: 0.2,
	trust: 0.4,
	disgust: 0.1,
	anticipation: 0.7,
	surprise: 0.2,
}
export const EMPATHETIC_EMOTION_PRESET: EmotionType = {
	joy: 0.6,
	sadness: 0.2,
	anger: 0.03,
	fear: 0.2,
	trust: 0.8,
	disgust: 0.05,
	anticipation: 0.4,
	surprise: 0.3,
}
export const PLAYFUL_EMOTION_PRESET: EmotionType = {
	joy: 0.7,
	sadness: 0.05,
	anger: 0.1,
	fear: 0.1,
	trust: 0.6,
	disgust: 0.05,
	anticipation: 0.8,
	surprise: 0.7,
}
export const CAUTIOUS_EMOTION_PRESET: EmotionType = {
	joy: 0.3,
	sadness: 0.2,
	anger: 0.1,
	fear: 0.5,
	trust: 0.3,
	disgust: 0.1,
	anticipation: 0.6,
	surprise: 0.4,
}
export const ADAPTIVE_EMOTION_PRESET: EmotionType = {
	joy: 0.4,
	sadness: 0.2,
	anger: 0.1,
	fear: 0.2,
	trust: 0.4,
	disgust: 0.1,
	anticipation: 0.5,
	surprise: 0.5,
}
export const DEFAULT_EMOTION_PRESET = NEUTRAL_EMOTION_PRESET

export const EMOTION_PRESETS: Record<PersonalityEnumType, EmotionType> = {
	[PERSONALITY_ENUM.NEUTRAL]: NEUTRAL_EMOTION_PRESET,
	[PERSONALITY_ENUM.CUSTOM]: NEUTRAL_EMOTION_PRESET,
	[PERSONALITY_ENUM.OPTIMISTIC]: OPTIMISTIC_EMOTION_PRESET,
	[PERSONALITY_ENUM.CALM]: CALM_EMOTION_PRESET,
	[PERSONALITY_ENUM.ANALYTICAL]: ANALYTICAL_EMOTION_PRESET,
	[PERSONALITY_ENUM.EMPATHETIC]: EMPATHETIC_EMOTION_PRESET,
	[PERSONALITY_ENUM.PLAYFUL]: PLAYFUL_EMOTION_PRESET,
	[PERSONALITY_ENUM.CAUTIOUS]: CAUTIOUS_EMOTION_PRESET,
	[PERSONALITY_ENUM.ADAPTIVE]: ADAPTIVE_EMOTION_PRESET,
} as const

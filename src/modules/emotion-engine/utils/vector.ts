import { type SelectEmotionStateType } from "@/db"

import { emotionSchema } from "../schemas"
import { type EmotionType, type EmotionPartialType } from "../types"
import { DEFAULT_EMOTION_PRESET } from "../constants"

export const normalizeEmotionVector = (vector?: EmotionType): EmotionType => {
	if (!vector) {
		return DEFAULT_EMOTION_PRESET
	}

	const normalized = Object.fromEntries(
		Object.entries(vector).map(([emotion, value]) => [
			emotion,
			Math.max(-1, Math.min(1, parseFloat(value.toFixed(3)))),
		]),
	) as EmotionType

	return emotionSchema.parse(normalized)
}

export const getInitEmotionVector = (): EmotionType => {
	return normalizeEmotionVector(DEFAULT_EMOTION_PRESET)
}

export const applyDelta = (
	vector: EmotionType,
	delta: EmotionPartialType,
): EmotionType => {
	const updated = { ...vector }
	for (const [emotion, value] of Object.entries(delta)) {
		updated[emotion as keyof EmotionType] = Math.max(
			-1,
			Math.min(1, vector[emotion as keyof EmotionType] + value),
		)
	}

	return normalizeEmotionVector(updated)
}

export const decayTowardBaseline = (
	vector: EmotionType,
	baseline: EmotionType,
	elapsedMs: number,
	halfLifeMs: Record<keyof EmotionType, number>,
): EmotionType => {
	const elapsed = Math.max(0, elapsedMs)
	const relaxed = Object.fromEntries(
		Object.entries(vector).map(([emotion, value]) => {
			const key = emotion as keyof EmotionType
			const halfLife = halfLifeMs[key]
			const fraction = halfLife > 0 ? 1 - Math.pow(0.5, elapsed / halfLife) : 1
			const target = baseline[key]
			return [emotion, value + (target - value) * fraction]
		}),
	) as EmotionType

	return normalizeEmotionVector(relaxed)
}

export const getEmotionVectorFromEmotionState = (
	state: SelectEmotionStateType | null | undefined,
): EmotionType => {
	if (!state) return getInitEmotionVector()

	return normalizeEmotionVector({
		joy: state.joy,
		sadness: state.sadness,
		anger: state.anger,
		fear: state.fear,
		trust: state.trust,
		disgust: state.disgust,
		anticipation: state.anticipation,
		surprise: state.surprise,
	})
}

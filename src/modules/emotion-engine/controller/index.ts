import { dbClient, type PersonalityEnumType, type DBClientOrTxType } from "@/db"
import { emotionEngineLogger } from "@/utils"
import { type DomiaType } from "@/modules/core"

import { emotionSchema } from "../schemas"
import { type EmotionType, type EmotionPartialType } from "../types"
import {
	normalizeEmotionVector,
	applyDelta,
	decay,
	getEmotionVectorFromEmotionState,
} from "../utils"
import { DEFAULT_EMOTION_PRESET, EMOTION_PRESETS } from "../constants"
import dbAdapter from "../db-adapter"
import { generateUuid } from "@/utils"

export const triggerEmotion = async (
	domia: DomiaType,
	cause: string,
	delta: EmotionPartialType,
) => {
	const domiaId = domia?.id
	const emotionState = domia?.emotionState
	emotionEngineLogger.info("Triggering emotion change", {
		domiaId,
		cause,
		delta,
	})

	const currentEmotionState = emotionState ?? {
		id: generateUuid(),
		domiaId,
	}

	const current = getEmotionVectorFromEmotionState(domia?.emotionState)
	const updated = normalizeEmotionVector(applyDelta(current, delta))
	const validatedEmotion = emotionSchema.parse(updated)

	dbClient.transaction((tx) => {
		dbAdapter
			.upsertEmotionState({ ...currentEmotionState, ...validatedEmotion }, tx)
			.run()

		dbAdapter
			.createEmotionEvent(
				{
					id: generateUuid(),
					domiaId,
					cause,
					delta,
				},
				tx,
			)
			.run()
	})

	emotionEngineLogger.info("Emotion change completed", {
		domiaId,
		cause,
		previousVector: current,
		newVector: validatedEmotion,
	})
	return validatedEmotion
}

export const decayEmotion = async (
	domia: DomiaType,
	client?: DBClientOrTxType,
) => {
	const domiaId = domia?.id
	emotionEngineLogger.info("Applying emotion decay", { domiaId })
	const emotionState = domia?.emotionState
	const current = getEmotionVectorFromEmotionState(emotionState)
	const decayed = decay(current)

	const currentEmotionState = emotionState ?? {
		id: generateUuid(),
		domiaId,
	}

	await dbAdapter.upsertEmotionState(
		{ ...currentEmotionState, ...decayed },
		client,
	)

	emotionEngineLogger.info("Emotion decay completed", {
		domiaId,
		previousVector: current,
		decayedVector: decayed,
	})
	return decayed
}

export const resetEmotion = async (
	domia: DomiaType,
	emotionVector: EmotionType = DEFAULT_EMOTION_PRESET,
	client?: DBClientOrTxType,
) => {
	const domiaId = domia?.id
	emotionEngineLogger.info("Resetting emotion state", { domiaId })
	const emotionState = domia?.emotionState

	const currentEmotionState = emotionState ?? {
		id: generateUuid(),
		domiaId,
	}

	await dbAdapter.upsertEmotionState(
		{ ...currentEmotionState, ...emotionVector },
		client,
	)

	emotionEngineLogger.info("Emotion state reset completed", {
		domiaId,
		emotionVector,
	})
	return emotionVector
}

export const getInitialEmotionState = (personality: PersonalityEnumType) => {
	return EMOTION_PRESETS?.[personality]
}

import { dbClient, PERSONALITY_ENUM } from "@/db"
import {
	emotionEngineLogger,
	generateUuid,
	parseDbTimestamp,
	now,
} from "@/utils"
import { type DomiaType, invalidateOwnDomia } from "@/modules/core"
import { type PersonaContextType } from "@/modules/prompt-context-builder"

import {
	emotionPartialSchema,
	emotionSchema,
	userEmotionSchema,
} from "../schemas"
import {
	type EmotionType,
	type EmotionPartialType,
	type EmotionAppraisalType,
	type EmotionTrajectoryEntryType,
	type UserEmotionType,
} from "../types"
import {
	applyDelta,
	decayTowardBaseline,
	getEmotionVectorFromEmotionState,
} from "../utils"
import {
	DEFAULT_EMOTION_PRESET,
	EMOTION_PRESETS,
	EMOTION_DECAY_HALF_LIFE_MS,
	EMOTION_APPRAISAL_MAX_DELTA,
	EMOTION_TRAJECTORY_WINDOW,
	EMOTION_TAG_DELTA,
	EMOTION_TAG_AXES,
	EMOTION_USER_REACTION_MATRIX,
	EMOTION_USER_SUSCEPTIBILITY,
	EMOTION_USER_INFLUENCE_MIN_DELTA,
} from "../constants"
import dbAdapter from "../db-adapter"

export const getEmotionEventsSince = (
	domiaId: string,
	since: string,
	limit: number,
) => dbAdapter.getEmotionEventsSince(domiaId, since, limit)

export const getLastEmotionEventAt = async (domiaId: string) => {
	const row = await dbAdapter.getLastEmotionEventAt(domiaId)
	return row?.createdAt ?? null
}

const EMOTION_KEYS = Object.keys(emotionSchema.shape) as (keyof EmotionType)[]

const baselineFor = (domia: DomiaType): EmotionType => {
	const personality = domia?.characterProfile?.personality
	return (personality && EMOTION_PRESETS[personality]) ?? DEFAULT_EMOTION_PRESET
}

const applyInMemory = (domia: DomiaType, vector: EmotionType): void => {
	if (domia?.emotionState)
		Object.assign(domia.emotionState, vector, { updatedAt: now() })
}

const elapsedSinceUpdate = (domia: DomiaType): number => {
	const parsed = parseDbTimestamp(domia?.emotionState?.updatedAt)
	const last = Number.isNaN(parsed) ? Date.now() : parsed
	return Math.max(0, Date.now() - last)
}

const moodFromPersona = (persona: PersonaContextType): EmotionType =>
	persona.emotionState ?? DEFAULT_EMOTION_PRESET

const renderTrajectory = (trajectory: EmotionTrajectoryEntryType[]): string => {
	if (!trajectory.length) return ""
	const lines = trajectory.map((entry) => {
		const moves = Object.entries(entry.delta)
			.map(([k, v]) => `${k}${(v ?? 0) >= 0 ? "↑" : "↓"}`)
			.join(" ")
		return `- ${entry.cause}${moves ? ` (${moves})` : ""}`
	})
	return lines.join("\n")
}

export const buildMoodContextLines = (
	persona: PersonaContextType,
	trajectory: EmotionTrajectoryEntryType[],
): string[] => {
	const name = persona.characterProfile?.name ?? "Domia"
	const personality = persona.characterProfile?.personality ?? "NEUTRAL"
	const mood = moodFromPersona(persona)
	const moodLine = EMOTION_KEYS.map((k) => `${k}=${mood[k].toFixed(2)}`).join(
		", ",
	)
	const lines = [
		`You are the emotional core of ${name}, a companion whose nature is ${personality}.`,
		`${name}'s current mood on a -1..1 scale: ${moodLine}.`,
	]
	if (trajectory.length) {
		lines.push(
			`Recent emotional shifts (oldest first):\n${renderTrajectory(trajectory)}`,
		)
	}
	return lines
}

export const emotionAppraisalInstructionLines = (): string[] => [
	`In "emotion" return how this exchange shifted the companion's OWN feelings about what happened: {"deltas": {emotion: signed number between -${EMOTION_APPRAISAL_MAX_DELTA} and ${EMOTION_APPRAISAL_MAX_DELTA}}, "cause": "2-5 word phrase"}. Do not mirror the person's mood here — that is captured separately in "userEmotion". In "deltas" include only emotions that genuinely shifted (positive = increase); use {} if none. Valid emotion keys: ${EMOTION_KEYS.join(", ")}.`,
]

export const parseEmotionFromObject = (
	emotionObj: unknown,
): EmotionAppraisalType => {
	if (!emotionObj || typeof emotionObj !== "object") {
		return { delta: {}, cause: "conversation" }
	}
	const obj = emotionObj as Record<string, unknown>
	const deltaSource =
		obj.deltas && typeof obj.deltas === "object"
			? (obj.deltas as Record<string, unknown>)
			: obj
	const clamped: Record<string, number> = {}
	for (const key of EMOTION_KEYS) {
		const value = deltaSource[key]
		if (typeof value !== "number" || Number.isNaN(value)) continue
		clamped[key] = Math.max(
			-EMOTION_APPRAISAL_MAX_DELTA,
			Math.min(EMOTION_APPRAISAL_MAX_DELTA, value),
		)
	}
	const result = emotionPartialSchema.safeParse(clamped)
	const cause =
		typeof obj.cause === "string" && obj.cause.trim()
			? obj.cause.trim().slice(0, 80)
			: "conversation"
	return { delta: result.success ? result.data : {}, cause }
}

export const userEmotionInstructionLines = (): string[] => [
	`In "userEmotion" return how the PERSON (the user) seemed to feel in their message: {"primary": <one of ${EMOTION_KEYS.join(", ")} or "neutral">, "intensity": 0..1, "note": "short phrase"}. Read the person's tone, not yours.`,
]

export const parseUserEmotionFromObject = (
	userEmotionObj: unknown,
): UserEmotionType | null => {
	const normalized =
		userEmotionObj && typeof userEmotionObj === "object"
			? {
					...userEmotionObj,
					intensity:
						typeof (userEmotionObj as { intensity?: unknown }).intensity ===
						"number"
							? Math.max(
									0,
									Math.min(
										1,
										(userEmotionObj as { intensity: number }).intensity,
									),
								)
							: (userEmotionObj as { intensity?: unknown }).intensity,
				}
			: userEmotionObj
	const result = userEmotionSchema.safeParse(normalized)
	if (!result.success) return null
	return {
		primary: result.data.primary.trim().slice(0, 40),
		intensity: result.data.intensity,
		note: result.data.note?.trim().slice(0, 120) ?? null,
	}
}

export const getRecentTrajectory = async (
	domiaId: string,
): Promise<EmotionTrajectoryEntryType[]> => {
	try {
		const rows = await dbAdapter.getRecentEmotionEvents(
			domiaId,
			EMOTION_TRAJECTORY_WINDOW,
		)
		return rows
			.map((row) => ({
				cause: row.cause,
				delta: (row.delta ?? {}) as EmotionPartialType,
			}))
			.reverse()
	} catch {
		return []
	}
}

export const applyMoodDelta = (
	origin: DomiaType,
	delta: EmotionPartialType,
	cause = "conversation",
): void => {
	if (!delta || Object.keys(delta).length === 0) return
	const current = getEmotionVectorFromEmotionState(origin?.emotionState)
	const relaxed = decayTowardBaseline(
		current,
		baselineFor(origin),
		elapsedSinceUpdate(origin),
		EMOTION_DECAY_HALF_LIFE_MS,
	)
	const next = applyDelta(relaxed, delta)
	const base = origin?.emotionState ?? {
		id: generateUuid(),
		domiaId: origin?.id,
	}
	dbClient.transaction((tx) => {
		dbAdapter.upsertEmotionState({ ...base, ...next }, tx).run()
		dbAdapter
			.createEmotionEvent(
				{
					id: generateUuid(),
					domiaId: origin?.id,
					cause,
					delta,
				},
				tx,
			)
			.run()
	})
	applyInMemory(origin, next)
	if (origin?.domiaKey) invalidateOwnDomia(origin.domiaKey)
	emotionEngineLogger.info("Mood delta applied", {
		domiaId: origin?.id,
		cause,
		delta,
		from: current,
		to: next,
	})
}

export const applyUserEmotionInfluence = (
	origin: DomiaType,
	userEmotion: UserEmotionType,
): void => {
	if (origin?.moduleSettings?.emotionEngine === false) return
	const primary = userEmotion.primary.toLowerCase()
	const axis = EMOTION_TAG_AXES.find((a) => a === primary)
	if (!axis) return
	const personality = origin?.characterProfile?.personality
	const susceptibility =
		(personality && EMOTION_USER_SUSCEPTIBILITY[personality]) ??
		EMOTION_USER_SUSCEPTIBILITY[PERSONALITY_ENUM.NEUTRAL]
	const intensity = Math.max(0, Math.min(1, userEmotion.intensity))
	const delta: EmotionPartialType = {}
	for (const [key, weight] of Object.entries(
		EMOTION_USER_REACTION_MATRIX[axis],
	)) {
		const value = Math.max(
			-EMOTION_APPRAISAL_MAX_DELTA,
			Math.min(
				EMOTION_APPRAISAL_MAX_DELTA,
				(weight ?? 0) * intensity * susceptibility,
			),
		)
		if (Math.abs(value) < EMOTION_USER_INFLUENCE_MIN_DELTA) continue
		delta[key as keyof EmotionType] = value
	}
	if (Object.keys(delta).length === 0) return
	applyMoodDelta(origin, delta, `user seemed ${axis}`)
}

export const applyExpressedEmotionTags = (
	origin: DomiaType,
	tags: string[],
): void => {
	if (origin?.moduleSettings?.emotionEngine === false) return
	const delta: EmotionPartialType = {}
	for (const tag of tags) {
		const axis = EMOTION_TAG_AXES.find((a) => a === tag.toLowerCase())
		if (!axis) continue
		delta[axis] = Math.min(
			EMOTION_APPRAISAL_MAX_DELTA,
			(delta[axis] ?? 0) + EMOTION_TAG_DELTA,
		)
	}
	if (Object.keys(delta).length === 0) return
	applyMoodDelta(origin, delta, "expressed")
}

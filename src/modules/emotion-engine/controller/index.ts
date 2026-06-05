import { dbClient } from "@/db"
import { env } from "@/config"
import { emotionEngineLogger, generateUuid } from "@/utils"
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
	if (domia?.emotionState) Object.assign(domia.emotionState, vector)
}

const elapsedSinceUpdate = (domia: DomiaType): number => {
	const updatedAt = domia?.emotionState?.updatedAt
	const last = updatedAt ? Date.parse(updatedAt) : Date.now()
	return Date.now() - last
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
	`In "emotion" return how this exchange shifted the companion's feelings: {"deltas": {emotion: signed number between -${EMOTION_APPRAISAL_MAX_DELTA} and ${EMOTION_APPRAISAL_MAX_DELTA}}, "cause": "2-5 word phrase"}. In "deltas" include only emotions that genuinely shifted (positive = increase); use {} if none. Valid emotion keys: ${EMOTION_KEYS.join(", ")}.`,
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
	const result = userEmotionSchema.safeParse(userEmotionObj)
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
	if (origin?.domiaKey === env.DOMIA_KEY) invalidateOwnDomia()
	emotionEngineLogger.info("Mood delta applied", {
		domiaId: origin?.id,
		cause,
		delta,
		from: current,
		to: next,
	})
}

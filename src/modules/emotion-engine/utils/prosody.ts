import {
	PROSODY_SPEED_AROUSAL_GAIN,
	PROSODY_SPEED_MIN,
	PROSODY_SPEED_MAX,
	PROSODY_PITCH_VALENCE_GAIN,
	PROSODY_PITCH_AROUSAL_GAIN,
	PROSODY_PITCH_MIN,
	PROSODY_PITCH_MAX,
	PROSODY_SILENCE_AROUSAL_GAIN,
	PROSODY_SILENCE_SADNESS_GAIN,
	PROSODY_SILENCE_MIN,
	PROSODY_SILENCE_MAX,
} from "../constants"
import type { EmotionType, MoodProsodyType, ProsodyVoiceType } from "../types"

const clamp = (v: number, lo: number, hi: number): number =>
	Math.max(lo, Math.min(hi, v))

export const expressivenessForStyle = (style?: string | null): number =>
	style === "minimal" ? 0.5 : style === "talkative" ? 1.6 : 1

export const moodToProsody = (
	mood: EmotionType,
	expressiveness = 1,
): MoodProsodyType => {
	const e = Math.max(0, expressiveness)
	const arousal = clamp(
		(mood.anger + mood.fear + mood.surprise + mood.anticipation + mood.joy) /
			5 -
			mood.sadness * 0.5,
		-1,
		1,
	)
	const valence = clamp(
		(mood.joy + mood.trust) / 2 -
			(mood.sadness + mood.anger + mood.fear + mood.disgust) / 4,
		-1,
		1,
	)
	return {
		speedMult: clamp(
			1 + arousal * PROSODY_SPEED_AROUSAL_GAIN * e,
			PROSODY_SPEED_MIN,
			PROSODY_SPEED_MAX,
		),
		pitchMult: clamp(
			1 +
				(valence * PROSODY_PITCH_VALENCE_GAIN +
					arousal * PROSODY_PITCH_AROUSAL_GAIN) *
					e,
			PROSODY_PITCH_MIN,
			PROSODY_PITCH_MAX,
		),
		silenceScaleMult: clamp(
			1 +
				(-arousal * PROSODY_SILENCE_AROUSAL_GAIN +
					Math.max(0, mood.sadness) * PROSODY_SILENCE_SADNESS_GAIN) *
					e,
			PROSODY_SILENCE_MIN,
			PROSODY_SILENCE_MAX,
		),
	}
}

export const tagBoostedMood = (
	mood: EmotionType,
	tags: string[],
	boost: number,
	blend: number,
): EmotionType => {
	const boosted = { ...mood }
	for (const tag of tags) {
		const axis = tag.toLowerCase() as keyof EmotionType
		if (!(axis in boosted)) continue
		boosted[axis] = clamp(boosted[axis] + boost, -1, 1)
	}
	const b = clamp(blend, 0, 1)
	const blended = Object.fromEntries(
		Object.entries(mood).map(([axis, value]) => [
			axis,
			value + (boosted[axis as keyof EmotionType] - value) * b,
		]),
	) as EmotionType
	return blended
}

export const applyMoodToVoice = <T extends ProsodyVoiceType>(
	voice: T,
	mood: EmotionType,
	expressiveness = 1,
): T => {
	const p = moodToProsody(mood, expressiveness)
	return {
		...voice,
		speed: voice.speed * p.speedMult,
		pitch: voice.pitch * p.pitchMult,
		silenceScale: voice.silenceScale * p.silenceScaleMult,
	}
}

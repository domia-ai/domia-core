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

export const moodToProsody = (mood: EmotionType): MoodProsodyType => {
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
			1 + arousal * PROSODY_SPEED_AROUSAL_GAIN,
			PROSODY_SPEED_MIN,
			PROSODY_SPEED_MAX,
		),
		pitchMult: clamp(
			1 +
				valence * PROSODY_PITCH_VALENCE_GAIN +
				arousal * PROSODY_PITCH_AROUSAL_GAIN,
			PROSODY_PITCH_MIN,
			PROSODY_PITCH_MAX,
		),
		silenceScaleMult: clamp(
			1 -
				arousal * PROSODY_SILENCE_AROUSAL_GAIN +
				Math.max(0, mood.sadness) * PROSODY_SILENCE_SADNESS_GAIN,
			PROSODY_SILENCE_MIN,
			PROSODY_SILENCE_MAX,
		),
	}
}

export const applyMoodToVoice = <T extends ProsodyVoiceType>(
	voice: T,
	mood: EmotionType,
): T => {
	const p = moodToProsody(mood)
	return {
		...voice,
		speed: voice.speed * p.speedMult,
		pitch: voice.pitch * p.pitchMult,
		silenceScale: voice.silenceScale * p.silenceScaleMult,
	}
}

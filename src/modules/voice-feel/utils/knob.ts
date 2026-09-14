import { VOICE_FEEL_KNOB_EPSILON } from "../constants"
import type { VoiceFeelConfigSourceType, VoiceFeelConfigType } from "../types"

export const voiceFeelConfigOf = (
	source: VoiceFeelConfigSourceType,
): VoiceFeelConfigType => ({
	wakeWord: source.wakeWordConfig ?? undefined,
	llm: source.llmModelConfig ?? undefined,
})

export const readVoiceFeelKnob = (
	current: VoiceFeelConfigType,
	section: string,
	field: string,
): number | null => {
	const value = current[section]?.[field]
	return typeof value === "number" && Number.isFinite(value) ? value : null
}

export const sameVoiceFeelKnobValue = (a: number, b: number): boolean =>
	Math.abs(a - b) < VOICE_FEEL_KNOB_EPSILON

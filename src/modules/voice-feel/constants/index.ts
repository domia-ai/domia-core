import {
	DEFAULT_DYNAMIC_ENDPOINT_MIN_MS,
	DEFAULT_ENDPOINT_COMPLETE_MS,
	DEFAULT_ENDPOINT_INCOMPLETE_MS,
	DEFAULT_LLM_MODEL_NUM_PREDICT,
	DEFAULT_VAD_MIN_SILENCE_S,
} from "@/db/constants"

import type { VoiceFeelFeaturesType } from "../types"

export const VOICE_FEEL_FEATURE_KEYS = [
	"turns",
	"earlyBargeInRate",
	"lateBargeInRate",
	"cutOffRate",
	"perceivedTtfaP50",
	"eouDelayP50",
	"noSpeechRate",
] as const satisfies readonly (keyof VoiceFeelFeaturesType)[]

export const VOICE_FEEL_HEARD_RATIO_BOUNDARY = 0.3
export const VOICE_FEEL_CLAMP_RATIO = 0.5
export const VOICE_FEEL_REVERT_WORSEN_RATIO = 0.25
export const VOICE_FEEL_DAY_MS = 86_400_000
export const VOICE_FEEL_RATE_DIGITS = 4
export const VOICE_FEEL_KNOB_DIGITS = 3
export const VOICE_FEEL_KNOB_EPSILON = 1e-6
export const VOICE_FEEL_HISTORY_LIMIT = 20

export const VOICE_FEEL_FORBIDDEN_FIELDS = [
	"bargeInEnabled",
	"bargeInMinRms",
	"pauseBargeInEnabled",
	"falseInterruptionTimeoutMs",
	"stopWordAbortEnabled",
	"stopWordMaxWords",
	"stopWordMaxExtraWords",
	"wakeWord",
	"sensitivity",
	"cooldown",
	"framework",
	"model",
	"customModelPath",
	"wakeVerifier",
	"wakeVerifierWindowMs",
	"wakeVerifierMinRms",
	"wakeVerifierMinSpeechMs",
	"wakeVerifierMinScore",
	"engine",
	"baseUrl",
	"apiKey",
	"quantization",
	"provider",
] as const

export const VOICE_FEEL_FORBIDDEN_SUFFIXES = [
	"Threshold",
	"Thresholds",
	"Engine",
	"ModelName",
	"ModelPath",
] as const

export const VOICE_FEEL_KNOB_DEFAULTS: Record<string, number> = {
	"wakeWord.vadMinSilenceS": DEFAULT_VAD_MIN_SILENCE_S,
	"wakeWord.endpointCompleteMs": DEFAULT_ENDPOINT_COMPLETE_MS,
	"wakeWord.endpointIncompleteMs": DEFAULT_ENDPOINT_INCOMPLETE_MS,
	"wakeWord.dynamicEndpointMinMs": DEFAULT_DYNAMIC_ENDPOINT_MIN_MS,
	"llm.numPredict": DEFAULT_LLM_MODEL_NUM_PREDICT,
}

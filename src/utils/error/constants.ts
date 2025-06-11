export const CORE_ERRORS = {
	DOMIA_NOT_FOUND: {
		code: "CORE/DOMIA_NOT_FOUND",
		message: "Domia instance not found in the database.",
	},
	DOMIAS_NOT_FOUND: {
		code: "CORE/DOMIAS_NOT_FOUND",
		message: "No Domia instances found in the database.",
	},
	WRONG_ENVIRONMENT: {
		code: "CORE/WRONG_ENVIRONMENT",
		message: "Environment configuration is invalid or incomplete.",
	},
} as const

export const AUDIO_ERRORS = {
	WAKE_WORD_ENGINE_NOT_FOUND: {
		code: "AUDIO/WAKE_WORD_ENGINE_NOT_FOUND",
		message: "Unsupported or missing wake word engine.",
	},
	WAKE_WORD_CONFIG_NOT_FOUND: {
		code: "AUDIO/WAKE_WORD_CONFIG_NOT_FOUND",
		message: "No wake word config found in the database.",
	},
} as const

export const CHARACTER_ERRORS = {
	PROFILE_NOT_FOUND: {
		code: "CHARACTER/PROFILE_NOT_FOUND",
		message: "Character profile is missing for this Domia.",
	},
	INVALID_PROFILE: {
		code: "CHARACTER/INVALID_PROFILE",
		message: "Character profile data is incomplete or malformed.",
	},
} as const

export const EMOTION_ERRORS = {
	EMOTION_STATE_NOT_FOUND: {
		code: "EMOTION/STATE_NOT_FOUND",
		message: "No emotion state found for the given Domia.",
	},
	INVALID_EMOTION_VECTOR: {
		code: "EMOTION/INVALID_VECTOR",
		message: "Provided emotion vector is invalid.",
	},
} as const

export const TTS_ERRORS = {
	VOICE_NOT_FOUND: {
		code: "TTS/VOICE_NOT_FOUND",
		message: "Requested voice not available or not installed.",
	},
	TTS_FAILURE: {
		code: "TTS/FAILURE",
		message: "Text-to-speech synthesis failed.",
	},
} as const

export const LLM_ERRORS = {
	LLM_ENGINE_NOT_FOUND: {
		code: "LLM/ENGINE_NOT_FOUND",
		message: "Unsupported or missing LLM engine.",
	},
	MODEL_NOT_FOUND: {
		code: "LLM/MODEL_NOT_FOUND",
		message: "The selected LLM model is not registered or installed.",
	},
	INVALID_PROMPT_CONTEXT: {
		code: "LLM/INVALID_PROMPT_CONTEXT",
		message: "Generated prompt context is invalid or missing data.",
	},
	ENGINE_FAILED: {
		code: "LLM/ENGINE_FAILED",
		message: "Failed to generate the LLM response.",
	},
} as const

export const AUDIO_PLAYBACK_ERRORS = {
	AUDIO_PLAYBACK_ENGINE_NOT_FOUND: {
		code: "AUDIO/ENGINE_NOT_FOUND",
		message: "Unsupported or missing audio engine.",
	},
} as const

export const STT_ERRORS = {
	STT_ENGINE_NOT_FOUND: {
		code: "STT/ENGINE_NOT_FOUND",
		message: "Unsupported or missing STT engine.",
	},
	AUDIO_INPUT_MISSING: {
		code: "STT/AUDIO_INPUT_MISSING",
		message: "No audio input detected.",
	},
	TRANSCRIPTION_FAILED: {
		code: "STT/TRANSCRIPTION_FAILED",
		message: "Failed to transcribe audio into text.",
	},
} as const

export const VALIDATION_ERRORS = {
	INVALID_CONFIG: {
		code: "VALIDATION/INVALID_CONFIG",
		message: "The configuration passed is invalid.",
	},
	MISSING_REQUIRED_FIELD: {
		code: "VALIDATION/MISSING_REQUIRED_FIELD",
		message: "A required field is missing from the input.",
	},
} as const

export const DB_ERRORS = {
	TRANSACTION_FAILED: {
		code: "DB/TRANSACTION_FAILED",
		message: "Database transaction could not be completed.",
	},
} as const

export const ERROR_CODES = {
	core: CORE_ERRORS,
	audio: AUDIO_ERRORS,
	"character-engine": CHARACTER_ERRORS,
	"emotion-engine": EMOTION_ERRORS,
	"tts-engine": TTS_ERRORS,
	"llm-engine": LLM_ERRORS,
	"stt-engine": STT_ERRORS,
	"audio-playback": AUDIO_PLAYBACK_ERRORS,
	validation: VALIDATION_ERRORS,
	db: DB_ERRORS,
} as const

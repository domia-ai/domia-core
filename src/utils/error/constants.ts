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
	MISSING_CAPABILITIES: {
		code: "CORE/MISSING_CAPABILITIES",
		message: "No runtine capabilities founded for the own domia.",
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
	TTS_ENGINE_NOT_FOUND: {
		code: "TTS/ENGINE_NOT_FOUND",
		message: "Unsupported or missing TTS engine.",
	},
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

export const SKILL_ERRORS = {
	PROVIDER_UNAVAILABLE: {
		code: "SKILL/PROVIDER_UNAVAILABLE",
		message: "The skill provider is not connected or unavailable.",
	},
	TOOL_CALL_FAILED: {
		code: "SKILL/TOOL_CALL_FAILED",
		message: "The tool call failed to execute.",
	},
	TOOL_TIMEOUT: {
		code: "SKILL/TOOL_TIMEOUT",
		message: "The tool call timed out before completing.",
	},
	TOOL_UNAUTHORIZED: {
		code: "SKILL/TOOL_UNAUTHORIZED",
		message: "The tool call was blocked by provider policy.",
	},
	MCP_CONNECT_FAILED: {
		code: "SKILL/MCP_CONNECT_FAILED",
		message: "Failed to connect to the MCP skill provider.",
	},
} as const

export const AGENT_ERRORS = {
	TOOL_LOOP_EXCEEDED: {
		code: "AGENT/TOOL_LOOP_EXCEEDED",
		message: "The agent exceeded the maximum tool-call iterations.",
	},
	DECISION_FAILED: {
		code: "AGENT/DECISION_FAILED",
		message: "The agent failed to reach a tool-or-reply decision.",
	},
	FINALIZE_FAILED: {
		code: "AGENT/FINALIZE_FAILED",
		message: "The agent failed to finalize the turn response.",
	},
} as const

export const GRPC_ERRORS = {
	TARGET_UNREACHABLE: {
		code: "GRPC/TARGET_UNREACHABLE",
		message: "The delegation target Domia is unreachable.",
	},
	DELEGATION_FAILED: {
		code: "GRPC/DELEGATION_FAILED",
		message: "The delegated turn failed on the responder.",
	},
	STREAM_INTERRUPTED: {
		code: "GRPC/STREAM_INTERRUPTED",
		message: "The delegation stream was interrupted before completion.",
	},
	DELIVERY_FAILED: {
		code: "GRPC/DELIVERY_FAILED",
		message: "Failed to deliver the delegated result back to the origin.",
	},
} as const

export const SATELLITE_ERRORS = {
	NOT_CONNECTED: {
		code: "SATELLITE/NOT_CONNECTED",
		message: "The satellite is not connected.",
	},
	PROTOCOL_ERROR: {
		code: "SATELLITE/PROTOCOL_ERROR",
		message: "The satellite protocol exchange failed.",
	},
	AUDIO_SINK_FAILED: {
		code: "SATELLITE/AUDIO_SINK_FAILED",
		message: "Failed to deliver audio to the satellite sink.",
	},
} as const

export const EMBEDDINGS_ERRORS = {
	MODEL_NOT_LOADED: {
		code: "EMBEDDINGS/MODEL_NOT_LOADED",
		message: "The embeddings model is not loaded.",
	},
	EMBED_FAILED: {
		code: "EMBEDDINGS/EMBED_FAILED",
		message: "Failed to compute embeddings for the given input.",
	},
} as const

export const CONFIG_APPLY_ERRORS = {
	RELOAD_FAILED: {
		code: "CONFIG_APPLY/RELOAD_FAILED",
		message: "Failed to reload the affected subsystem after a config change.",
	},
	SUBSYSTEM_BUSY: {
		code: "CONFIG_APPLY/SUBSYSTEM_BUSY",
		message: "The subsystem is busy and cannot apply the config change now.",
	},
	UNKNOWN_SUBSYSTEM: {
		code: "CONFIG_APPLY/UNKNOWN_SUBSYSTEM",
		message: "No reloader is registered for the target subsystem.",
	},
} as const

export const ERROR_CODES = {
	core: CORE_ERRORS,
	audio: AUDIO_ERRORS,
	"emotion-engine": EMOTION_ERRORS,
	"tts-engine": TTS_ERRORS,
	"llm-engine": LLM_ERRORS,
	"stt-engine": STT_ERRORS,
	"audio-playback": AUDIO_PLAYBACK_ERRORS,
	validation: VALIDATION_ERRORS,
	db: DB_ERRORS,
	"skill-engine": SKILL_ERRORS,
	agent: AGENT_ERRORS,
	"grpc-client": GRPC_ERRORS,
	satellite: SATELLITE_ERRORS,
	embeddings: EMBEDDINGS_ERRORS,
	"config-apply": CONFIG_APPLY_ERRORS,
} as const

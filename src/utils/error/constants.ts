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
	IDENTITY_NOT_HOSTED: {
		code: "CORE/IDENTITY_NOT_HOSTED",
		message: "The identity is not hosted by this node.",
	},
	IDENTITY_NOT_RESOLVABLE: {
		code: "CORE/IDENTITY_NOT_RESOLVABLE",
		message: "The identity could not be resolved from the database.",
	},
	TLS_MATERIAL_UNREADABLE: {
		code: "CORE/TLS_MATERIAL_UNREADABLE",
		message:
			"A TLS certificate, key or CA file from the environment could not be read.",
	},
	OTEL_INIT_FAILED: {
		code: "CORE/OTEL_INIT_FAILED",
		message: "The OpenTelemetry exporter could not be initialised.",
	},
	INTERACTION_CREATE_FAILED: {
		code: "CORE/INTERACTION_CREATE_FAILED",
		message: "The interaction could not be created.",
	},
	INTERACTION_RELOAD_GATED: {
		code: "CORE/INTERACTION_RELOAD_GATED",
		message: "A config reload is in flight for this identity.",
	},
	HOST_NODE_MISSING: {
		code: "CORE/HOST_NODE_MISSING",
		message: "The host_node singleton row is missing after ensure.",
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
	WAKE_WORD_MODEL_PATH_MISSING: {
		code: "AUDIO/WAKE_WORD_MODEL_PATH_MISSING",
		message: "The wake word engine requires wakeWordConfig.customModelPath.",
	},
	WAKE_WORD_MODEL_FILES_MISSING: {
		code: "AUDIO/WAKE_WORD_MODEL_FILES_MISSING",
		message: "Wake word model files are missing or incomplete.",
	},
	AUDIO_FILE_NOT_FOUND: {
		code: "AUDIO/FILE_NOT_FOUND",
		message: "The audio file does not exist.",
	},
	DENOISE_MODEL_MISSING: {
		code: "AUDIO/DENOISE_MODEL_MISSING",
		message: "The speech-enhancement model file is missing.",
	},
} as const

export const AEC_ERRORS = {
	PACTL_FAILED: {
		code: "AEC/PACTL_FAILED",
		message: "The PulseAudio/PipeWire control command failed.",
	},
	MODULE_INDEX_UNPARSEABLE: {
		code: "AEC/MODULE_INDEX_UNPARSEABLE",
		message: "module-echo-cancel loaded but no module index was returned.",
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
	EMPTY_TEXT: {
		code: "TTS/EMPTY_TEXT",
		message: "Nothing to speak after sanitizing the text.",
	},
	EMPTY_AUDIO: {
		code: "TTS/EMPTY_AUDIO",
		message: "Text-to-speech produced no audio.",
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
	ABORTED: {
		code: "LLM/ABORTED",
		message: "The LLM request was aborted before inference started.",
	},
	SLOT_WAIT_TIMEOUT: {
		code: "LLM/SLOT_WAIT_TIMEOUT",
		message: "Timed out waiting for a free LLM server slot.",
	},
} as const

export const AUDIO_PLAYBACK_ERRORS = {
	AUDIO_PLAYBACK_ENGINE_NOT_FOUND: {
		code: "AUDIO/ENGINE_NOT_FOUND",
		message: "Unsupported or missing audio engine.",
	},
	AUDIO_SOURCE_MISSING: {
		code: "AUDIO_PLAYBACK/SOURCE_MISSING",
		message: "Playback needs a filePath or an audioUrl.",
	},
	PLAYBACK_FAILED: {
		code: "AUDIO_PLAYBACK/FAILED",
		message: "The audio playback engine reported a failure.",
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
	SESSION_ENGINE_NOT_STREAMING: {
		code: "STT/SESSION_ENGINE_NOT_STREAMING",
		message: "STT sessions require a streaming (online) engine.",
	},
	NO_ACTIVE_SESSION: {
		code: "STT/NO_ACTIVE_SESSION",
		message: "No STT session is active in this worker.",
	},
} as const

export const MODEL_MANAGER_ERRORS = {
	INSTALL_HOST_NOT_ALLOWED: {
		code: "MODEL_MANAGER/INSTALL_HOST_NOT_ALLOWED",
		message: "The model install URL is not http(s) or its host is not allowed.",
	},
	UNSAFE_ARCHIVE_ENTRY: {
		code: "MODEL_MANAGER/UNSAFE_ARCHIVE_ENTRY",
		message:
			"The model archive contains an entry that escapes the models dir or is not a plain file or directory.",
	},
	TOO_MANY_REDIRECTS: {
		code: "MODEL_MANAGER/TOO_MANY_REDIRECTS",
		message: "The model download redirected more times than allowed.",
	},
	DOWNLOAD_FAILED: {
		code: "MODEL_MANAGER/DOWNLOAD_FAILED",
		message: "The model download did not return a usable response body.",
	},
	DOWNLOAD_TOO_LARGE: {
		code: "MODEL_MANAGER/DOWNLOAD_TOO_LARGE",
		message: "The model download exceeds the maximum install size.",
	},
	DOWNLOAD_VERIFICATION_FAILED: {
		code: "MODEL_MANAGER/DOWNLOAD_VERIFICATION_FAILED",
		message: "The downloaded model does not match its expected size or digest.",
	},
	ARCHIVE_CONTENT_MISSING: {
		code: "MODEL_MANAGER/ARCHIVE_CONTENT_MISSING",
		message: "The model archive does not contain the expected directory.",
	},
	TOO_MANY_INSTALL_JOBS: {
		code: "MODEL_MANAGER/TOO_MANY_INSTALL_JOBS",
		message: "Too many model installs are already running on this node.",
	},
	UNSAFE_TARGET_PATH: {
		code: "MODEL_MANAGER/UNSAFE_TARGET_PATH",
		message: "The model install target escapes the models directory.",
	},
} as const

export const VALIDATION_ERRORS = {
	MISSING_REQUIRED_FIELD: {
		code: "VALIDATION/MISSING_REQUIRED_FIELD",
		message: "A required field is missing from the input.",
	},
	INVALID_FILE_PATH: {
		code: "VALIDATION/INVALID_FILE_PATH",
		message: "The file path is outside the directories this node may read.",
	},
	UNSUPPORTED_CONFIG_VERSION: {
		code: "VALIDATION/UNSUPPORTED_CONFIG_VERSION",
		message: "The config bundle version is newer than this node supports.",
	},
} as const

export const BENCH_ERRORS = {
	CORPUS_NOT_FOUND: {
		code: "BENCH/CORPUS_NOT_FOUND",
		message: "The golden voice corpus is not available on this node.",
	},
} as const

export const GRPC_ERRORS = {
	TARGET_UNREACHABLE: {
		code: "GRPC/TARGET_UNREACHABLE",
		message: "No gRPC client could be opened for the delegation target.",
	},
	DELEGATION_FAILED: {
		code: "GRPC/DELEGATION_FAILED",
		message: "The delegated stage failed on every attempted target.",
	},
	CAPABILITY_DISABLED: {
		code: "GRPC/CAPABILITY_DISABLED",
		message: "The requested capability is disabled on this Domia.",
	},
} as const

export const SATELLITE_ERRORS = {
	LIVEKIT_NO_LOCAL_PARTICIPANT: {
		code: "SATELLITE/LIVEKIT_NO_LOCAL_PARTICIPANT",
		message: "The LiveKit room has no local participant to publish on.",
	},
} as const

export const SKILL_ERRORS = {
	PROVIDER_NOT_READY: {
		code: "SKILL/PROVIDER_NOT_READY",
		message: "The skill provider has not finished loading its context.",
	},
	INVALID_PROVIDER_CONFIG: {
		code: "SKILL/INVALID_PROVIDER_CONFIG",
		message: "The skill provider configuration is invalid for its transport.",
	},
	RUNTIME_PORT_UNSET: {
		code: "SKILL/RUNTIME_PORT_UNSET",
		message: "The skill runtime port has not been installed on this node.",
	},
	ROUTINE_INVALID: {
		code: "SKILL/ROUTINE_INVALID",
		message: "The routine definition is invalid.",
	},
} as const

export const AGENT_ERRORS = {
	DECISION_UNAVAILABLE: {
		code: "AGENT/DECISION_UNAVAILABLE",
		message: "Structured decisions are not available for this LLM engine.",
	},
	DECISION_UNPARSEABLE: {
		code: "AGENT/DECISION_UNPARSEABLE",
		message: "The structured decision returned by the model is unparseable.",
	},
} as const

export const MIND_ERRORS = {
	NO_CHARACTER_PROFILE: {
		code: "MIND/NO_CHARACTER_PROFILE",
		message: "The Domia has no active character profile.",
	},
	TEMPLATE_NOT_FOUND: {
		code: "MIND/TEMPLATE_NOT_FOUND",
		message: "The requested mind template does not exist.",
	},
} as const

export const MIND_TRANSFER_ERRORS = {
	IDENTITY_NOT_FOUND: {
		code: "MIND_TRANSFER/IDENTITY_NOT_FOUND",
		message: "The Domia identity the transfer targets does not exist.",
	},
	BUNDLE_INVALID: {
		code: "MIND_TRANSFER/BUNDLE_INVALID",
		message: "The mind bundle is not a valid versioned export.",
	},
	BUNDLE_INCONSISTENT: {
		code: "MIND_TRANSFER/BUNDLE_INCONSISTENT",
		message: "The mind bundle references rows it does not carry.",
	},
	IMPORT_CONFLICT: {
		code: "MIND_TRANSFER/IMPORT_CONFLICT",
		message: "The target already holds different content for imported rows.",
	},
	IMPORT_VERIFY_FAILED: {
		code: "MIND_TRANSFER/IMPORT_VERIFY_FAILED",
		message: "The post-write verification of the mind import failed.",
	},
	REPLACE_TARGET_MISSING: {
		code: "MIND_TRANSFER/REPLACE_TARGET_MISSING",
		message: "Replace mode needs a single target identity to clear.",
	},
} as const

export const HTTP_ERRORS = {
	REQUEST_FAILED: {
		code: "HTTP/REQUEST_FAILED",
		message: "The HTTP request returned a non-success status.",
	},
} as const

export const ERROR_CODES = {
	aec: AEC_ERRORS,
	core: CORE_ERRORS,
	audio: AUDIO_ERRORS,
	"tts-engine": TTS_ERRORS,
	"llm-engine": LLM_ERRORS,
	"stt-engine": STT_ERRORS,
	"audio-playback": AUDIO_PLAYBACK_ERRORS,
	"model-manager": MODEL_MANAGER_ERRORS,
	validation: VALIDATION_ERRORS,
	grpc: GRPC_ERRORS,
	satellite: SATELLITE_ERRORS,
	skill: SKILL_ERRORS,
	agent: AGENT_ERRORS,
	mind: MIND_ERRORS,
	"mind-transfer": MIND_TRANSFER_ERRORS,
	http: HTTP_ERRORS,
	bench: BENCH_ERRORS,
} as const

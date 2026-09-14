import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core"
import {
	WAKE_WORD_ENGINE_ENUM,
	WAKE_WORD_ENGINE_ENUM_VALUES,
	DEFAULT_WAKE_WORD,
	DEFAULT_WAKE_WORD_MODEL,
	DEFAULT_WAKE_WORD_MODEL_PATH,
	DEFAULT_VAD_ENGINE,
	VAD_ENGINE_ENUM_VALUES,
	DEFAULT_VAD_MODEL_PATH,
	DEFAULT_WAKE_WORD_SENSITIVITY,
	DEFAULT_WAKE_WORD_THRESHOLD,
	DEFAULT_WAKE_WORD_COOLDOWN_S,
	DEFAULT_WAKE_WORD_NUM_THREADS,
	DEFAULT_WAKE_WORD_PROVIDER,
	DEFAULT_VAD_THRESHOLD,
	DEFAULT_VAD_MIN_SILENCE_S,
	DEFAULT_VAD_END_OF_SPEECH_MS,
	DEFAULT_VAD_PREWARM_ON_BOOT,
	DEFAULT_FOLLOW_UP_WINDOW_MS,
	DEFAULT_BARGE_IN_ENABLED,
	DEFAULT_SPECULATIVE_SILENCE_MS,
	DEFAULT_SEMANTIC_ENDPOINTING_ENABLED,
	DEFAULT_ACOUSTIC_ENDPOINTING_ENABLED,
	DEFAULT_SUPPRESS_WAKE_WHILE_PEER_SPEAKS,
	DEFAULT_ACOUSTIC_ENDPOINT_THRESHOLD,
	DEFAULT_ACOUSTIC_GATE_COOLDOWN_MS,
	DEFAULT_ACOUSTIC_MAX_HOLD_MS,
	DEFAULT_ACOUSTIC_TAIL_KEEP_MS,
	DEFAULT_ACOUSTIC_LOCAL_MAX_HOLD_MS,
	DEFAULT_BARGE_IN_MIN_RMS,
	DEFAULT_TURN_DETECTOR_MODEL_PATH,
	DEFAULT_TURN_DETECTOR_ENGINE,
	TURN_DETECTOR_ENGINE_ENUM_VALUES,
	DEFAULT_SPECULATIVE_TTS_ENABLED,
	DEFAULT_SATELLITE_SPECULATION_ENABLED,
	DEFAULT_SPECULATE_WITH_SKILLS,
	DEFAULT_TWO_TIER_ENDPOINT_ENABLED,
	DEFAULT_TWO_TIER_EAGER_MIN_PARTIAL_CHARS,
	DEFAULT_TWO_TIER_PREFILL_IDLE_GUARD_MS,
	DEFAULT_TWO_TIER_RESUME_GRACE_MS,
	DEFAULT_TWO_TIER_MAX_EAGER_PREFILLS,
	DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS,
	DEFAULT_SPECULATION_MAX_ATTEMPTS,
	DEFAULT_SPECULATION_MAX_UTTERANCE_MS,
	DEFAULT_SPECULATION_SKILL_GATE_MAX_SCORE,
	DEFAULT_SHARED_MIC_STREAM_ENABLED,
	DEFAULT_ENDPOINT_COMPLETE_MS,
	DEFAULT_DYNAMIC_ENDPOINTING_ENABLED,
	DEFAULT_DYNAMIC_ENDPOINT_MIN_MS,
	DEFAULT_DYNAMIC_ENDPOINT_MAX_MS,
	DEFAULT_DYNAMIC_ENDPOINT_ALPHA,
	DEFAULT_DYNAMIC_ENDPOINT_MARGIN,
	DEFAULT_PAUSE_BARGE_IN_ENABLED,
	DEFAULT_FALSE_INTERRUPTION_TIMEOUT_MS,
	DEFAULT_ECHO_SUPPRESS_ENABLED,
	DEFAULT_ECHO_SUPPRESS_MARGIN_MS,
	DEFAULT_ENDPOINT_INCOMPLETE_MS,
	DEFAULT_ENDPOINT_WAIT_MS,
	DEFAULT_FOLLOW_UP_LEAD_PAD_MS,
	AEC_BACKEND_ENUM_VALUES,
	DEFAULT_AEC_ENABLED,
	DEFAULT_AEC_BACKEND,
	DEFAULT_AEC_METHOD,
	DEFAULT_AEC_SOURCE_NAME,
	DEFAULT_AEC_SINK_NAME,
	DEFAULT_AEC_SET_DEFAULT_DEVICES,
	SPEECH_ENHANCER_ENGINE_ENUM_VALUES,
	DEFAULT_DENOISE_ENABLED,
	DEFAULT_DENOISE_ENGINE,
	DEFAULT_DENOISE_MODEL_PATH,
	DEFAULT_DENOISE_NUM_THREADS,
	DEFAULT_DENOISE_PROVIDER,
	DEFAULT_ECHO_RESIDUAL_GATE_ENABLED,
	DEFAULT_ECHO_RESIDUAL_MIN_RATIO,
	DEFAULT_ECHO_RESIDUAL_WINDOW_MS,
	DEFAULT_ECHO_RESIDUAL_MAX_DELAY_MS,
	DEFAULT_ECHO_RESIDUAL_MIN_RMS,
	DEFAULT_ECHO_RESIDUAL_MIN_FRAMES,
	DEFAULT_ECHO_REFERENCE_SECONDS,
	DEFAULT_ECHO_LIVE_SPEECH_TTL_MS,
	DEFAULT_STOP_WORD_ABORT_ENABLED,
	DEFAULT_STOP_WORD_MAX_WORDS,
	DEFAULT_STOP_WORD_MAX_EXTRA_WORDS,
	WAKE_VERIFIER_ENUM_VALUES,
	DEFAULT_WAKE_VERIFIER,
	DEFAULT_WAKE_VERIFIER_WINDOW_MS,
	DEFAULT_WAKE_VERIFIER_MIN_RMS,
	DEFAULT_WAKE_VERIFIER_MIN_SPEECH_MS,
	DEFAULT_WAKE_VERIFIER_MIN_SCORE,
	DEFAULT_WAKE_VERIFIER_MAX_MS,
	DEFAULT_AUDIO_CAPTURE_SAMPLE_RATE,
	DEFAULT_AUDIO_CAPTURE_BITS_PER_SAMPLE,
	DEFAULT_AUDIO_CAPTURE_CHANNELS,
	DEFAULT_AUDIO_CAPTURE_MAX_RECORDING_MS,
	WAKE_WORD_FRAMEWORK_ENUM_VALUES,
	WAKE_WORD_FRAMEWORK_ENUM,
	DEFAULT_QUANTIZATION,
} from "../constants"
import { DEFAULT_TIMESTAMP } from "./shared"
import { domia } from "./identity"

export const wakeWordConfig = sqliteTable("wake_word_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", {
		enum: WAKE_WORD_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(WAKE_WORD_ENGINE_ENUM.KWS),
	wakeWord: text("wake_word").notNull().default(DEFAULT_WAKE_WORD),
	sensitivity: real("sensitivity")
		.notNull()
		.default(DEFAULT_WAKE_WORD_SENSITIVITY),
	threshold: real("threshold").notNull().default(DEFAULT_WAKE_WORD_THRESHOLD),
	cooldown: real("cooldown").notNull().default(DEFAULT_WAKE_WORD_COOLDOWN_S),
	numThreads: integer("ww_num_threads")
		.notNull()
		.default(DEFAULT_WAKE_WORD_NUM_THREADS),
	provider: text("ww_provider").notNull().default(DEFAULT_WAKE_WORD_PROVIDER),
	framework: text("framework", {
		enum: WAKE_WORD_FRAMEWORK_ENUM_VALUES,
	})
		.notNull()
		.default(WAKE_WORD_FRAMEWORK_ENUM.ONNX),
	model: text("model").notNull().default(DEFAULT_WAKE_WORD_MODEL),
	customModelPath: text("custom_model_path")
		.notNull()
		.default(DEFAULT_WAKE_WORD_MODEL_PATH),
	quantization: text("quantization").notNull().default(DEFAULT_QUANTIZATION),
	vadEngine: text("vad_engine", { enum: VAD_ENGINE_ENUM_VALUES })
		.notNull()
		.default(DEFAULT_VAD_ENGINE),
	vadModelPath: text("vad_model_path")
		.notNull()
		.default(DEFAULT_VAD_MODEL_PATH),
	vadThreshold: real("vad_threshold").notNull().default(DEFAULT_VAD_THRESHOLD),
	vadMinSilenceS: real("vad_min_silence_s")
		.notNull()
		.default(DEFAULT_VAD_MIN_SILENCE_S),
	vadEndOfSpeechMs: integer("vad_end_of_speech_ms")
		.notNull()
		.default(DEFAULT_VAD_END_OF_SPEECH_MS),
	vadPrewarmOnBoot: integer("vad_prewarm_on_boot", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_VAD_PREWARM_ON_BOOT),
	inputDeviceIndex: integer("device").notNull().default(0),
	sampleRate: integer("sample_rate")
		.notNull()
		.default(DEFAULT_AUDIO_CAPTURE_SAMPLE_RATE),
	bitsPerSample: integer("bits_per_sample")
		.notNull()
		.default(DEFAULT_AUDIO_CAPTURE_BITS_PER_SAMPLE),
	channels: integer("channels")
		.notNull()
		.default(DEFAULT_AUDIO_CAPTURE_CHANNELS),
	maxRecordingMs: integer("max_recording_ms")
		.notNull()
		.default(DEFAULT_AUDIO_CAPTURE_MAX_RECORDING_MS),
	followUpWindowMs: integer("follow_up_window_ms")
		.notNull()
		.default(DEFAULT_FOLLOW_UP_WINDOW_MS),
	bargeInEnabled: integer("barge_in_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_BARGE_IN_ENABLED),
	speculativeSilenceMs: integer("speculative_silence_ms")
		.notNull()
		.default(DEFAULT_SPECULATIVE_SILENCE_MS),
	satelliteSpeculationEnabled: integer("satellite_speculation_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_SATELLITE_SPECULATION_ENABLED),
	semanticEndpointingEnabled: integer("semantic_endpointing_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_SEMANTIC_ENDPOINTING_ENABLED),
	acousticEndpointingEnabled: integer("acoustic_endpointing_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_ACOUSTIC_ENDPOINTING_ENABLED),
	acousticEndpointCompleteThreshold: real(
		"acoustic_endpoint_complete_threshold",
	)
		.notNull()
		.default(DEFAULT_ACOUSTIC_ENDPOINT_THRESHOLD),
	acousticGateCooldownMs: integer("acoustic_gate_cooldown_ms")
		.notNull()
		.default(DEFAULT_ACOUSTIC_GATE_COOLDOWN_MS),
	acousticMaxHoldMs: integer("acoustic_max_hold_ms")
		.notNull()
		.default(DEFAULT_ACOUSTIC_MAX_HOLD_MS),
	acousticTailKeepMs: integer("acoustic_tail_keep_ms")
		.notNull()
		.default(DEFAULT_ACOUSTIC_TAIL_KEEP_MS),
	acousticLocalMaxHoldMs: integer("acoustic_local_max_hold_ms")
		.notNull()
		.default(DEFAULT_ACOUSTIC_LOCAL_MAX_HOLD_MS),
	bargeInMinRms: real("barge_in_min_rms")
		.notNull()
		.default(DEFAULT_BARGE_IN_MIN_RMS),
	suppressWakeWhilePeerSpeaks: integer("suppress_wake_while_peer_speaks", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_SUPPRESS_WAKE_WHILE_PEER_SPEAKS),
	turnDetectorEngine: text("turn_detector_engine", {
		enum: TURN_DETECTOR_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_TURN_DETECTOR_ENGINE),
	turnDetectorModelPath: text("turn_detector_model_path")
		.notNull()
		.default(DEFAULT_TURN_DETECTOR_MODEL_PATH),
	speculativeTtsEnabled: integer("speculative_tts_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_SPECULATIVE_TTS_ENABLED),
	speculateWithSkills: integer("speculate_with_skills", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_SPECULATE_WITH_SKILLS),
	speculationSkillGateMaxScore: real("speculation_skill_gate_max_score")
		.notNull()
		.default(DEFAULT_SPECULATION_SKILL_GATE_MAX_SCORE),
	twoTierEndpointEnabled: integer("two_tier_endpoint_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_TWO_TIER_ENDPOINT_ENABLED),
	twoTierEagerMinPartialChars: integer("two_tier_eager_min_partial_chars")
		.notNull()
		.default(DEFAULT_TWO_TIER_EAGER_MIN_PARTIAL_CHARS),
	twoTierPrefillIdleGuardMs: integer("two_tier_prefill_idle_guard_ms")
		.notNull()
		.default(DEFAULT_TWO_TIER_PREFILL_IDLE_GUARD_MS),
	twoTierResumeGraceMs: integer("two_tier_resume_grace_ms")
		.notNull()
		.default(DEFAULT_TWO_TIER_RESUME_GRACE_MS),
	twoTierMaxEagerPrefills: integer("two_tier_max_eager_prefills")
		.notNull()
		.default(DEFAULT_TWO_TIER_MAX_EAGER_PREFILLS),
	twoTierSettleMaxWaitMs: integer("two_tier_settle_max_wait_ms")
		.notNull()
		.default(DEFAULT_TWO_TIER_SETTLE_MAX_WAIT_MS),
	speculationMaxAttempts: integer("speculation_max_attempts")
		.notNull()
		.default(DEFAULT_SPECULATION_MAX_ATTEMPTS),
	speculationMaxUtteranceMs: integer("speculation_max_utterance_ms")
		.notNull()
		.default(DEFAULT_SPECULATION_MAX_UTTERANCE_MS),
	sharedMicStreamEnabled: integer("shared_mic_stream_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_SHARED_MIC_STREAM_ENABLED),
	endpointCompleteMs: integer("endpoint_complete_ms")
		.notNull()
		.default(DEFAULT_ENDPOINT_COMPLETE_MS),
	endpointIncompleteMs: integer("endpoint_incomplete_ms")
		.notNull()
		.default(DEFAULT_ENDPOINT_INCOMPLETE_MS),
	endpointWaitMs: integer("endpoint_wait_ms")
		.notNull()
		.default(DEFAULT_ENDPOINT_WAIT_MS),
	dynamicEndpointingEnabled: integer("dynamic_endpointing_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_DYNAMIC_ENDPOINTING_ENABLED),
	dynamicEndpointMinMs: integer("dynamic_endpoint_min_ms")
		.notNull()
		.default(DEFAULT_DYNAMIC_ENDPOINT_MIN_MS),
	dynamicEndpointMaxMs: integer("dynamic_endpoint_max_ms")
		.notNull()
		.default(DEFAULT_DYNAMIC_ENDPOINT_MAX_MS),
	dynamicEndpointAlpha: real("dynamic_endpoint_alpha")
		.notNull()
		.default(DEFAULT_DYNAMIC_ENDPOINT_ALPHA),
	dynamicEndpointMargin: real("dynamic_endpoint_margin")
		.notNull()
		.default(DEFAULT_DYNAMIC_ENDPOINT_MARGIN),
	pauseBargeInEnabled: integer("pause_barge_in_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_PAUSE_BARGE_IN_ENABLED),
	falseInterruptionTimeoutMs: integer("false_interruption_timeout_ms")
		.notNull()
		.default(DEFAULT_FALSE_INTERRUPTION_TIMEOUT_MS),
	echoSuppressEnabled: integer("echo_suppress_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_ECHO_SUPPRESS_ENABLED),
	echoSuppressMarginMs: integer("echo_suppress_margin_ms")
		.notNull()
		.default(DEFAULT_ECHO_SUPPRESS_MARGIN_MS),
	followUpLeadPadMs: integer("follow_up_lead_pad_ms")
		.notNull()
		.default(DEFAULT_FOLLOW_UP_LEAD_PAD_MS),
	aecEnabled: integer("aec_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_AEC_ENABLED),
	aecBackend: text("aec_backend", { enum: AEC_BACKEND_ENUM_VALUES })
		.notNull()
		.default(DEFAULT_AEC_BACKEND),
	aecMethod: text("aec_method").notNull().default(DEFAULT_AEC_METHOD),
	aecSourceMaster: text("aec_source_master"),
	aecSinkMaster: text("aec_sink_master"),
	aecSourceName: text("aec_source_name")
		.notNull()
		.default(DEFAULT_AEC_SOURCE_NAME),
	aecSinkName: text("aec_sink_name").notNull().default(DEFAULT_AEC_SINK_NAME),
	aecSetDefaultDevices: integer("aec_set_default_devices", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_AEC_SET_DEFAULT_DEVICES),
	denoiseEnabled: integer("denoise_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_DENOISE_ENABLED),
	denoiseEngine: text("denoise_engine", {
		enum: SPEECH_ENHANCER_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_DENOISE_ENGINE),
	denoiseModelPath: text("denoise_model_path")
		.notNull()
		.default(DEFAULT_DENOISE_MODEL_PATH),
	denoiseNumThreads: integer("denoise_num_threads")
		.notNull()
		.default(DEFAULT_DENOISE_NUM_THREADS),
	denoiseProvider: text("denoise_provider")
		.notNull()
		.default(DEFAULT_DENOISE_PROVIDER),
	echoResidualGateEnabled: integer("echo_residual_gate_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_ECHO_RESIDUAL_GATE_ENABLED),
	echoResidualMinRatio: real("echo_residual_min_ratio")
		.notNull()
		.default(DEFAULT_ECHO_RESIDUAL_MIN_RATIO),
	echoResidualWindowMs: integer("echo_residual_window_ms")
		.notNull()
		.default(DEFAULT_ECHO_RESIDUAL_WINDOW_MS),
	echoResidualMaxDelayMs: integer("echo_residual_max_delay_ms")
		.notNull()
		.default(DEFAULT_ECHO_RESIDUAL_MAX_DELAY_MS),
	echoResidualMinRms: real("echo_residual_min_rms")
		.notNull()
		.default(DEFAULT_ECHO_RESIDUAL_MIN_RMS),
	echoResidualMinFrames: integer("echo_residual_min_frames")
		.notNull()
		.default(DEFAULT_ECHO_RESIDUAL_MIN_FRAMES),
	echoReferenceSeconds: real("echo_reference_seconds")
		.notNull()
		.default(DEFAULT_ECHO_REFERENCE_SECONDS),
	echoLiveSpeechTtlMs: integer("echo_live_speech_ttl_ms")
		.notNull()
		.default(DEFAULT_ECHO_LIVE_SPEECH_TTL_MS),
	stopWordAbortEnabled: integer("stop_word_abort_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_STOP_WORD_ABORT_ENABLED),
	stopWordMaxWords: integer("stop_word_max_words")
		.notNull()
		.default(DEFAULT_STOP_WORD_MAX_WORDS),
	stopWordMaxExtraWords: integer("stop_word_max_extra_words")
		.notNull()
		.default(DEFAULT_STOP_WORD_MAX_EXTRA_WORDS),
	wakeVerifier: text("wake_verifier", { enum: WAKE_VERIFIER_ENUM_VALUES })
		.notNull()
		.default(DEFAULT_WAKE_VERIFIER),
	wakeVerifierWindowMs: integer("wake_verifier_window_ms")
		.notNull()
		.default(DEFAULT_WAKE_VERIFIER_WINDOW_MS),
	wakeVerifierMinRms: real("wake_verifier_min_rms")
		.notNull()
		.default(DEFAULT_WAKE_VERIFIER_MIN_RMS),
	wakeVerifierMinSpeechMs: integer("wake_verifier_min_speech_ms")
		.notNull()
		.default(DEFAULT_WAKE_VERIFIER_MIN_SPEECH_MS),
	wakeVerifierMinScore: real("wake_verifier_min_score")
		.notNull()
		.default(DEFAULT_WAKE_VERIFIER_MIN_SCORE),
	wakeVerifierMaxMs: integer("wake_verifier_max_ms")
		.notNull()
		.default(DEFAULT_WAKE_VERIFIER_MAX_MS),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core"
import type { TtsEngineConfigType } from "../json-types"
import {
	STT_ENGINE_ENUM,
	STT_ENGINE_ENUM_VALUES,
	LLM_ENGINE_ENUM,
	LLM_ENGINE_ENUM_VALUES,
	REASONING_EFFORT_ENUM_VALUES,
	DEFAULT_REASONING_EFFORT,
	DEFAULT_REFLECTION_REASONING_EFFORT,
	TTS_ENGINE_ENUM,
	TTS_ENGINE_ENUM_VALUES,
	DEFAULT_LANGUAGE,
	DEFAULT_LLM_MODEL_TEMPERATURE,
	DEFAULT_LLM_MODEL_CONTEXT_WINDOW,
	DEFAULT_LLM_MODEL_NUM_PREDICT,
	DEFAULT_TTS_PACER_ENABLED,
	DEFAULT_TTS_PACER_MIN_REMAINING_MS,
	DEFAULT_TTS_PACER_MAX_CHARS,
	DEFAULT_SENTENCE_SOFT_FLUSH_MIN_CHARS,
	DEFAULT_SENTENCE_FIRST_UNIT_MAX_WORDS,
	DEFAULT_SENTENCE_MEDIUM_FLUSH_CHARS,
	DEFAULT_SENTENCE_HARD_FLUSH_CHARS,
	DEFAULT_SENTENCE_FIRST_FLUSH_MAX_MS,
	DEFAULT_PIPELINE_MAX_QUEUE_DEPTH,
	DEFAULT_PIPELINE_EAGER_TTS_SENTENCES,
	DEFAULT_STT_POOL_EXECUTION_TIMEOUT_MS,
	DEFAULT_TTS_POOL_EXECUTION_TIMEOUT_MS,
	DEFAULT_LLM_CONCURRENCY,
	DEFAULT_STT_MODEL_NAME,
	DEFAULT_STT_TIMEOUT_MS,
	DEFAULT_STT_MODEL_PATH,
	DEFAULT_STT_ENABLE_ENDPOINT,
	DEFAULT_STT_RULE1_MIN_TRAILING_SILENCE,
	DEFAULT_STT_RULE2_MIN_TRAILING_SILENCE,
	DEFAULT_STT_RULE3_MIN_UTTERANCE_LENGTH,
	DEFAULT_STT_NUM_THREADS,
	DEFAULT_STT_PROVIDER,
	DEFAULT_STT_DECODE_PADDING_MS,
	DEFAULT_STT_FLUSH_PADDING_MS,
	DEFAULT_STT_PARTIAL_AT_ENDPOINT_ENABLED,
	DEFAULT_STT_POOL_WARM_WORKERS,
	DEFAULT_STT_POOL_MAX_WORKERS,
	DEFAULT_STT_POOL_AUTO_SCALE_ENABLED,
	DEFAULT_STT_POOL_IDLE_TIMEOUT_MS,
	DEFAULT_STT_POOL_QUEUE_MAX_DEPTH,
	DEFAULT_STT_POOL_QUEUE_TIMEOUT_MS,
	DEFAULT_STT_MAX_CONCURRENT_STREAMING_SESSIONS,
	DEFAULT_STT_SESSION_IDLE_TIMEOUT_MS,
	DEFAULT_STT_WORKER_RECYCLE_AFTER_JOBS,
	DEFAULT_LLM_MODEL_NAME,
	DEFAULT_OLLAMA_HOST,
	DEFAULT_OLLAMA_KEEP_ALIVE_MS,
	DEFAULT_TTS_VOICE_NAME,
	DEFAULT_TTS_MODEL_PATH,
	DEFAULT_TTS_NUM_THREADS,
	DEFAULT_TTS_PROVIDER,
	DEFAULT_TTS_MAX_NUM_SENTENCES,
	DEFAULT_TTS_SILENCE_SCALE,
	DEFAULT_TTS_SPEED,
	DEFAULT_TTS_STREAMING_ENABLED,
	DEFAULT_TTS_PHRASE_CACHE_ENABLED,
	DEFAULT_TTS_PHRASE_CACHE_ENTRIES,
	DEFAULT_TTS_PHRASE_CACHE_MAX_CHARS,
	DEFAULT_TTS_POOL_WARM_WORKERS,
	DEFAULT_TTS_POOL_MAX_WORKERS,
	DEFAULT_TTS_POOL_AUTO_SCALE_ENABLED,
	DEFAULT_TTS_POOL_IDLE_TIMEOUT_MS,
	DEFAULT_TTS_POOL_QUEUE_MAX_DEPTH,
	DEFAULT_TTS_POOL_QUEUE_TIMEOUT_MS,
	DEFAULT_TTS_WORKER_RECYCLE_AFTER_JOBS,
	DEFAULT_QUANTIZATION,
	ASYNC_FOLLOW_UP_POLICY_ENUM_VALUES,
	DEFAULT_ASYNC_FOLLOW_UP_POLICY,
	DEFAULT_ASYNC_FOLLOW_UP_MAX_WAIT_MS,
	DEFAULT_LLM_STREAM_IDLE_MS,
	DEFAULT_QUIET_AUDIO_POLL_MS,
	DEFAULT_QUIET_AUDIO_DEADLINE_MS,
	DEFAULT_AGENT_REPEAT_WARN_AT,
	DEFAULT_AGENT_REPEAT_BLOCK_AT,
	DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN,
	DEFAULT_AGENT_RECENT_TOOLS_TURNS,
	DEFAULT_AGENT_QUESTION_GUARD_ENABLED,
	DEFAULT_AGENT_TARGET_GUARD_ENABLED,
	DEFAULT_AGENT_READ_THEN_ANSWER_ENABLED,
	DEFAULT_TOOL_REQUEST_MAX_RETRIES,
	DEFAULT_FAST_PATH_COMPOUND_ENABLED,
	DEFAULT_FAST_PATH_COMPOUND_MAX_TARGETS,
	DEFAULT_ANAPHORA_MAX_AGE_MS,
	DEFAULT_FAST_PATH_ENABLED,
	DEFAULT_FAST_PATH_MIN_COVERAGE,
	DEFAULT_FAST_PATH_MAX_UTTERANCE_CHARS,
	DEFAULT_FAST_PATH_BLOCKLIST_ENABLED,
	DEFAULT_CONSTRAINED_REPAIR_ENABLED,
	DEFAULT_SLOT_WAIT_TIMEOUT_MS,
	DEFAULT_SLOT_WAIT_POLL_MS,
	DEFAULT_INTENT_LLM_ON_SINGLE_SLOT,
	AGENT_DECISION_MODE_ENUM_VALUES,
	DEFAULT_AGENT_DECISION_MODE,
	DEFAULT_AUTHORED_SPEECH_ENABLED,
	AGENT_PROMPT_MODE_ENUM_VALUES,
	DEFAULT_AGENT_PROMPT_MODE,
	SKILLS_ROUTING_ENUM_VALUES,
	DEFAULT_SKILLS_ROUTING,
	DEFAULT_INTENT_EMBED_THRESHOLD,
	DEFAULT_INTENT_LEXICAL_MIN_SCORE,
	DEFAULT_INTENT_CACHE_ENABLED,
	DEFAULT_INTENT_CACHE_SIZE,
	DEFAULT_INTENT_CACHE_MIN_SIMILARITY,
	DEFAULT_DESCRIPTOR_ROUTING_ENABLED,
	DEFAULT_AGENT_MAX_STEPS,
	DEFAULT_AGENT_BUDGET_MS,
	DEFAULT_TOOL_CALL_TEMPERATURE,
	DEFAULT_TOOL_CALL_NUM_PREDICT,
	DEFAULT_CONFIRMATION_TTL_MS,
	DEFAULT_AGENT_ACK_AFTER_MS,
	DEFAULT_TOOL_SHORTLIST_MAX,
	MATCHER_ENGINE_ENUM_VALUES,
	DEFAULT_MATCHER_ENGINE,
	DEFAULT_MATCHER_SEMANTIC_THRESHOLD,
	DEFAULT_MATCHER_RRF_K,
	DEFAULT_MATCHER_CASCADE_EXIT,
	DEFAULT_LLM_SLOT_AFFINITY_ENABLED,
	EMBED_BACKEND_ENUM_VALUES,
	DEFAULT_EMBED_BACKEND,
	DEFAULT_EMBED_MODEL_PATH,
	DEFAULT_SENTENCE_FIRST_FRAGMENT_MAX_WORDS,
	DEFAULT_TTS_PHRASE_CACHE_MAX_BYTES,
	DEFAULT_TTS_PHRASE_CACHE_WARMUP_ENABLED,
	DEFAULT_TTS_PHRASE_CACHE_REPLY_UNITS_ENABLED,
	DEFAULT_TTS_PHRASE_CACHE_VOICE_STEP,
	DEFAULT_TTS_PREWARM_ON_BOOT,
	DEFAULT_TTS_PREWARM_ON_RELOAD,
	DEFAULT_TTS_PREWARM_PASSES,
} from "../constants"
import { DEFAULT_TIMESTAMP } from "./shared"
import { domia } from "./identity"

export const sttConfig = sqliteTable("stt_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", { enum: STT_ENGINE_ENUM_VALUES })
		.notNull()
		.default(STT_ENGINE_ENUM.PARAKEET),
	modelName: text("model_name").notNull().default(DEFAULT_STT_MODEL_NAME),
	baseUrl: text("base_url"),
	apiKey: text("api_key"),
	language: text("language").notNull().default(DEFAULT_LANGUAGE),
	modelPath: text("model_path").notNull().default(DEFAULT_STT_MODEL_PATH),
	quantization: text("quantization").notNull().default(DEFAULT_QUANTIZATION),
	silenceThreshold: real("silence_threshold"),
	bufferSize: integer("buffer_size"),
	timeoutMs: integer("timeout_ms").notNull().default(DEFAULT_STT_TIMEOUT_MS),
	enableEndpoint: integer("enable_endpoint", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_STT_ENABLE_ENDPOINT),
	rule1MinTrailingSilence: real("rule1_min_trailing_silence")
		.notNull()
		.default(DEFAULT_STT_RULE1_MIN_TRAILING_SILENCE),
	rule2MinTrailingSilence: real("rule2_min_trailing_silence")
		.notNull()
		.default(DEFAULT_STT_RULE2_MIN_TRAILING_SILENCE),
	rule3MinUtteranceLength: real("rule3_min_utterance_length")
		.notNull()
		.default(DEFAULT_STT_RULE3_MIN_UTTERANCE_LENGTH),
	numThreads: integer("stt_num_threads")
		.notNull()
		.default(DEFAULT_STT_NUM_THREADS),
	provider: text("stt_provider").notNull().default(DEFAULT_STT_PROVIDER),
	decodePaddingMs: integer("stt_decode_padding_ms")
		.notNull()
		.default(DEFAULT_STT_DECODE_PADDING_MS),
	flushPaddingMs: integer("stt_flush_padding_ms")
		.notNull()
		.default(DEFAULT_STT_FLUSH_PADDING_MS),
	partialAtEndpointEnabled: integer("stt_partial_at_endpoint_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_STT_PARTIAL_AT_ENDPOINT_ENABLED),
	poolWarmWorkers: integer("stt_pool_warm_workers")
		.notNull()
		.default(DEFAULT_STT_POOL_WARM_WORKERS),
	poolMaxWorkers: integer("stt_pool_max_workers")
		.notNull()
		.default(DEFAULT_STT_POOL_MAX_WORKERS),
	poolAutoScaleEnabled: integer("stt_pool_auto_scale_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_STT_POOL_AUTO_SCALE_ENABLED),
	poolIdleTimeoutMs: integer("stt_pool_idle_timeout_ms")
		.notNull()
		.default(DEFAULT_STT_POOL_IDLE_TIMEOUT_MS),
	poolQueueMaxDepth: integer("stt_pool_queue_max_depth")
		.notNull()
		.default(DEFAULT_STT_POOL_QUEUE_MAX_DEPTH),
	poolQueueTimeoutMs: integer("stt_pool_queue_timeout_ms")
		.notNull()
		.default(DEFAULT_STT_POOL_QUEUE_TIMEOUT_MS),
	poolExecutionTimeoutMs: integer("stt_pool_execution_timeout_ms")
		.notNull()
		.default(DEFAULT_STT_POOL_EXECUTION_TIMEOUT_MS),
	maxConcurrentStreamingSessions: integer(
		"stt_max_concurrent_streaming_sessions",
	)
		.notNull()
		.default(DEFAULT_STT_MAX_CONCURRENT_STREAMING_SESSIONS),
	sessionIdleTimeoutMs: integer("stt_session_idle_timeout_ms")
		.notNull()
		.default(DEFAULT_STT_SESSION_IDLE_TIMEOUT_MS),
	workerRecycleAfterJobs: integer("stt_worker_recycle_after_jobs")
		.notNull()
		.default(DEFAULT_STT_WORKER_RECYCLE_AFTER_JOBS),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const llmModelConfig = sqliteTable("llm_model_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", { enum: LLM_ENGINE_ENUM_VALUES })
		.notNull()
		.default(LLM_ENGINE_ENUM.OLLAMA),
	modelName: text("model_name").notNull().default(DEFAULT_LLM_MODEL_NAME),
	baseUrl: text("base_url").notNull().default(DEFAULT_OLLAMA_HOST),
	apiKey: text("api_key"),
	reflectionModelName: text("reflection_model_name"),
	reasoningEffort: text("reasoning_effort", {
		enum: REASONING_EFFORT_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_REASONING_EFFORT),
	reflectionReasoningEffort: text("reflection_reasoning_effort", {
		enum: REASONING_EFFORT_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_REFLECTION_REASONING_EFFORT),
	temperature: real("temperature")
		.notNull()
		.default(DEFAULT_LLM_MODEL_TEMPERATURE),
	contextWindow: integer("context_window")
		.notNull()
		.default(DEFAULT_LLM_MODEL_CONTEXT_WINDOW),
	numPredict: integer("num_predict")
		.notNull()
		.default(DEFAULT_LLM_MODEL_NUM_PREDICT),
	llmConcurrency: integer("llm_concurrency")
		.notNull()
		.default(DEFAULT_LLM_CONCURRENCY),
	keepAliveMs: integer("keep_alive_ms")
		.notNull()
		.default(DEFAULT_OLLAMA_KEEP_ALIVE_MS),
	streamUsage: integer("stream_usage", { mode: "boolean" })
		.notNull()
		.default(true),
	useCompactPrompt: integer("use_compact_prompt", { mode: "boolean" })
		.notNull()
		.default(false),
	agentPromptMode: text("agent_prompt_mode", {
		enum: AGENT_PROMPT_MODE_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_AGENT_PROMPT_MODE),
	skillsRouting: text("skills_routing", {
		enum: SKILLS_ROUTING_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_SKILLS_ROUTING),
	intentModelName: text("intent_model_name"),
	embeddingModelName: text("embedding_model_name"),
	intentEmbedThreshold: real("intent_embed_threshold")
		.notNull()
		.default(DEFAULT_INTENT_EMBED_THRESHOLD),
	intentLexicalMinScore: real("intent_lexical_min_score")
		.notNull()
		.default(DEFAULT_INTENT_LEXICAL_MIN_SCORE),
	descriptorRoutingEnabled: integer("descriptor_routing_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_DESCRIPTOR_ROUTING_ENABLED),
	toolModelName: text("tool_model_name"),
	agentMaxSteps: integer("agent_max_steps")
		.notNull()
		.default(DEFAULT_AGENT_MAX_STEPS),
	agentBudgetMs: integer("agent_budget_ms")
		.notNull()
		.default(DEFAULT_AGENT_BUDGET_MS),
	confirmationTtlMs: integer("confirmation_ttl_ms")
		.notNull()
		.default(DEFAULT_CONFIRMATION_TTL_MS),
	agentAckAfterMs: integer("agent_ack_after_ms")
		.notNull()
		.default(DEFAULT_AGENT_ACK_AFTER_MS),
	toolShortlistMax: integer("tool_shortlist_max")
		.notNull()
		.default(DEFAULT_TOOL_SHORTLIST_MAX),
	matcherEngine: text("matcher_engine", {
		enum: MATCHER_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_MATCHER_ENGINE),
	matcherSemanticThreshold: real("matcher_semantic_threshold")
		.notNull()
		.default(DEFAULT_MATCHER_SEMANTIC_THRESHOLD),
	matcherRrfK: integer("matcher_rrf_k")
		.notNull()
		.default(DEFAULT_MATCHER_RRF_K),
	matcherCascadeExit: real("matcher_cascade_exit")
		.notNull()
		.default(DEFAULT_MATCHER_CASCADE_EXIT),
	embedBackend: text("embed_backend", {
		enum: EMBED_BACKEND_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_EMBED_BACKEND),
	embedModelPath: text("embed_model_path")
		.notNull()
		.default(DEFAULT_EMBED_MODEL_PATH),
	slotAffinityEnabled: integer("slot_affinity_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_LLM_SLOT_AFFINITY_ENABLED),
	repeatPenalty: real("repeat_penalty"),
	topK: integer("top_k"),
	minP: real("min_p"),
	seed: integer("seed"),
	stopSequences: text("stop_sequences", { mode: "json" }).$type<
		string[] | null
	>(),
	toolTemperature: real("tool_temperature")
		.notNull()
		.default(DEFAULT_TOOL_CALL_TEMPERATURE),
	toolNumPredict: integer("tool_num_predict")
		.notNull()
		.default(DEFAULT_TOOL_CALL_NUM_PREDICT),
	asyncFollowUpPolicy: text("async_follow_up_policy", {
		enum: ASYNC_FOLLOW_UP_POLICY_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_ASYNC_FOLLOW_UP_POLICY),
	asyncFollowUpMaxWaitMs: integer("async_follow_up_max_wait_ms")
		.notNull()
		.default(DEFAULT_ASYNC_FOLLOW_UP_MAX_WAIT_MS),
	llmStreamIdleMs: integer("llm_stream_idle_ms")
		.notNull()
		.default(DEFAULT_LLM_STREAM_IDLE_MS),
	quietAudioPollMs: integer("quiet_audio_poll_ms")
		.notNull()
		.default(DEFAULT_QUIET_AUDIO_POLL_MS),
	quietAudioDeadlineMs: integer("quiet_audio_deadline_ms")
		.notNull()
		.default(DEFAULT_QUIET_AUDIO_DEADLINE_MS),
	agentRepeatWarnAt: integer("agent_repeat_warn_at")
		.notNull()
		.default(DEFAULT_AGENT_REPEAT_WARN_AT),
	agentRepeatBlockAt: integer("agent_repeat_block_at")
		.notNull()
		.default(DEFAULT_AGENT_REPEAT_BLOCK_AT),
	agentMaxToolCallsPerTurn: integer("agent_max_tool_calls_per_turn")
		.notNull()
		.default(DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN),
	agentRecentToolsTurns: integer("agent_recent_tools_turns")
		.notNull()
		.default(DEFAULT_AGENT_RECENT_TOOLS_TURNS),
	agentQuestionGuardEnabled: integer("agent_question_guard_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_AGENT_QUESTION_GUARD_ENABLED),
	agentTargetGuardEnabled: integer("agent_target_guard_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_AGENT_TARGET_GUARD_ENABLED),
	agentReadThenAnswerEnabled: integer("agent_read_then_answer_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_AGENT_READ_THEN_ANSWER_ENABLED),
	toolRequestMaxRetries: integer("tool_request_max_retries")
		.notNull()
		.default(DEFAULT_TOOL_REQUEST_MAX_RETRIES),
	anaphoraMaxAgeMs: integer("anaphora_max_age_ms")
		.notNull()
		.default(DEFAULT_ANAPHORA_MAX_AGE_MS),
	fastPathEnabled: integer("fast_path_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_FAST_PATH_ENABLED),
	fastPathMinCoverage: real("fast_path_min_coverage")
		.notNull()
		.default(DEFAULT_FAST_PATH_MIN_COVERAGE),
	fastPathCompoundEnabled: integer("fast_path_compound_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_FAST_PATH_COMPOUND_ENABLED),
	fastPathCompoundMaxTargets: integer("fast_path_compound_max_targets")
		.notNull()
		.default(DEFAULT_FAST_PATH_COMPOUND_MAX_TARGETS),
	intentCacheEnabled: integer("intent_cache_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_INTENT_CACHE_ENABLED),
	intentCacheSize: integer("intent_cache_size")
		.notNull()
		.default(DEFAULT_INTENT_CACHE_SIZE),
	intentCacheMinSimilarity: real("intent_cache_min_similarity")
		.notNull()
		.default(DEFAULT_INTENT_CACHE_MIN_SIMILARITY),
	fastPathMaxUtteranceChars: integer("fast_path_max_utterance_chars")
		.notNull()
		.default(DEFAULT_FAST_PATH_MAX_UTTERANCE_CHARS),
	fastPathBlocklistEnabled: integer("fast_path_blocklist_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_FAST_PATH_BLOCKLIST_ENABLED),
	constrainedRepairEnabled: integer("constrained_repair_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_CONSTRAINED_REPAIR_ENABLED),
	slotWaitTimeoutMs: integer("slot_wait_timeout_ms")
		.notNull()
		.default(DEFAULT_SLOT_WAIT_TIMEOUT_MS),
	slotWaitPollMs: integer("slot_wait_poll_ms")
		.notNull()
		.default(DEFAULT_SLOT_WAIT_POLL_MS),
	intentLlmOnSingleSlot: integer("intent_llm_on_single_slot", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_INTENT_LLM_ON_SINGLE_SLOT),
	agentDecisionMode: text("agent_decision_mode", {
		enum: AGENT_DECISION_MODE_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_AGENT_DECISION_MODE),
	authoredSpeechEnabled: integer("authored_speech_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_AUTHORED_SPEECH_ENABLED),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const ttsConfig = sqliteTable("tts_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", {
		enum: TTS_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(TTS_ENGINE_ENUM.KOKORO),
	voiceName: text("voice_name").notNull().default(DEFAULT_TTS_VOICE_NAME),
	language: text("language").notNull().default(DEFAULT_LANGUAGE),
	modelPath: text("model_path").notNull().default(DEFAULT_TTS_MODEL_PATH),
	espeakNgDataPath: text("espeak_ng_data_path"),
	engineConfig: text("engine_config", {
		mode: "json",
	}).$type<TtsEngineConfigType>(),
	quantization: text("quantization"),
	pitch: real("pitch").notNull().default(1),
	speed: real("speed").notNull().default(DEFAULT_TTS_SPEED),
	silenceScale: real("silence_scale")
		.notNull()
		.default(DEFAULT_TTS_SILENCE_SCALE),
	numThreads: integer("num_threads").notNull().default(DEFAULT_TTS_NUM_THREADS),
	provider: text("provider").notNull().default(DEFAULT_TTS_PROVIDER),
	maxNumSentences: integer("max_num_sentences")
		.notNull()
		.default(DEFAULT_TTS_MAX_NUM_SENTENCES),
	streamingEnabled: integer("streaming_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_TTS_STREAMING_ENABLED),
	pacerEnabled: integer("pacer_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_TTS_PACER_ENABLED),
	pacerMinRemainingMs: integer("pacer_min_remaining_ms")
		.notNull()
		.default(DEFAULT_TTS_PACER_MIN_REMAINING_MS),
	pacerMaxChars: integer("pacer_max_chars")
		.notNull()
		.default(DEFAULT_TTS_PACER_MAX_CHARS),

	poolWarmWorkers: integer("tts_pool_warm_workers")
		.notNull()
		.default(DEFAULT_TTS_POOL_WARM_WORKERS),
	poolMaxWorkers: integer("tts_pool_max_workers")
		.notNull()
		.default(DEFAULT_TTS_POOL_MAX_WORKERS),
	poolAutoScaleEnabled: integer("tts_pool_auto_scale_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_TTS_POOL_AUTO_SCALE_ENABLED),
	poolIdleTimeoutMs: integer("tts_pool_idle_timeout_ms")
		.notNull()
		.default(DEFAULT_TTS_POOL_IDLE_TIMEOUT_MS),
	poolQueueMaxDepth: integer("tts_pool_queue_max_depth")
		.notNull()
		.default(DEFAULT_TTS_POOL_QUEUE_MAX_DEPTH),
	poolQueueTimeoutMs: integer("tts_pool_queue_timeout_ms")
		.notNull()
		.default(DEFAULT_TTS_POOL_QUEUE_TIMEOUT_MS),
	poolExecutionTimeoutMs: integer("tts_pool_execution_timeout_ms")
		.notNull()
		.default(DEFAULT_TTS_POOL_EXECUTION_TIMEOUT_MS),
	phraseCacheEnabled: integer("phrase_cache_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_TTS_PHRASE_CACHE_ENABLED),
	phraseCacheEntries: integer("phrase_cache_entries")
		.notNull()
		.default(DEFAULT_TTS_PHRASE_CACHE_ENTRIES),
	phraseCacheMaxChars: integer("phrase_cache_max_chars")
		.notNull()
		.default(DEFAULT_TTS_PHRASE_CACHE_MAX_CHARS),
	sentenceSoftFlushMinChars: integer("sentence_soft_flush_min_chars")
		.notNull()
		.default(DEFAULT_SENTENCE_SOFT_FLUSH_MIN_CHARS),
	sentenceFirstUnitMaxWords: integer("sentence_first_unit_max_words")
		.notNull()
		.default(DEFAULT_SENTENCE_FIRST_UNIT_MAX_WORDS),
	sentenceMediumFlushChars: integer("sentence_medium_flush_chars")
		.notNull()
		.default(DEFAULT_SENTENCE_MEDIUM_FLUSH_CHARS),
	sentenceHardFlushChars: integer("sentence_hard_flush_chars")
		.notNull()
		.default(DEFAULT_SENTENCE_HARD_FLUSH_CHARS),
	sentenceFirstFlushMaxMs: integer("sentence_first_flush_max_ms")
		.notNull()
		.default(DEFAULT_SENTENCE_FIRST_FLUSH_MAX_MS),
	pipelineMaxQueueDepth: integer("pipeline_max_queue_depth")
		.notNull()
		.default(DEFAULT_PIPELINE_MAX_QUEUE_DEPTH),
	pipelineEagerTtsSentences: integer("pipeline_eager_tts_sentences")
		.notNull()
		.default(DEFAULT_PIPELINE_EAGER_TTS_SENTENCES),
	workerRecycleAfterJobs: integer("tts_worker_recycle_after_jobs")
		.notNull()
		.default(DEFAULT_TTS_WORKER_RECYCLE_AFTER_JOBS),
	phraseCacheMaxBytes: integer("phrase_cache_max_bytes")
		.notNull()
		.default(DEFAULT_TTS_PHRASE_CACHE_MAX_BYTES),
	phraseCacheWarmupEnabled: integer("phrase_cache_warmup_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_TTS_PHRASE_CACHE_WARMUP_ENABLED),
	phraseCacheReplyUnitsEnabled: integer("phrase_cache_reply_units_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_TTS_PHRASE_CACHE_REPLY_UNITS_ENABLED),
	phraseCacheVoiceStep: real("phrase_cache_voice_step")
		.notNull()
		.default(DEFAULT_TTS_PHRASE_CACHE_VOICE_STEP),
	sentenceFirstFragmentMaxWords: integer("sentence_first_fragment_max_words")
		.notNull()
		.default(DEFAULT_SENTENCE_FIRST_FRAGMENT_MAX_WORDS),
	prewarmOnBoot: integer("prewarm_on_boot", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_TTS_PREWARM_ON_BOOT),
	prewarmOnReload: integer("prewarm_on_reload", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_TTS_PREWARM_ON_RELOAD),
	prewarmPasses: integer("prewarm_passes")
		.notNull()
		.default(DEFAULT_TTS_PREWARM_PASSES),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

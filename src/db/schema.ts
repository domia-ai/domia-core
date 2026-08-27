import {
	sqliteTable,
	text,
	real,
	integer,
	unique,
	index,
} from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"

import type {
	SkillAuthType,
	SkillToolType,
	SkillProviderConfigType,
	DomiaSkillDescriptorType,
	TtsEngineConfigType,
	ToolTraceEntryType,
} from "./json-types"
import {
	PERSONALITY_ENUM,
	PERSONALITY_ENUM_VALUES,
	PROFESSION_ENUM,
	PROFESSION_ENUM_VALUES,
	COMMUNICATION_STYLE_ENUM,
	COMMUNICATION_STYLE_ENUM_VALUES,
	PERCEIVED_AGE_ENUM,
	PERCEIVED_AGE_ENUM_VALUES,
	KNOWLEDGE_DEPTH_ENUM,
	KNOWLEDGE_DEPTH_ENUM_VALUES,
	RELATIONSHIP_TYPE_ENUM,
	RELATIONSHIP_TYPE_ENUM_VALUES,
	ROLE_MODE_ENUM,
	ROLE_MODE_ENUM_VALUES,
	EMOTION_EXPRESSION_STYLE_ENUM_VALUES,
	DEFAULT_EMOTION_EXPRESSION_STYLE,
	FACT_KIND_ENUM_VALUES,
	DEFAULT_FACT_KIND,
	WAKE_WORD_ENGINE_ENUM,
	WAKE_WORD_ENGINE_ENUM_VALUES,
	STT_ENGINE_ENUM,
	STT_ENGINE_ENUM_VALUES,
	LLM_ENGINE_ENUM,
	LLM_ENGINE_ENUM_VALUES,
	TTS_ENGINE_ENUM,
	TTS_ENGINE_ENUM_VALUES,
	DEFAULT_LANGUAGE,
	DEFAULT_WAKE_WORD,
	DEFAULT_LLM_MODEL_TEMPERATURE,
	DEFAULT_LLM_MODEL_CONTEXT_WINDOW,
	DEFAULT_LLM_MODEL_NUM_PREDICT,
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
	DEFAULT_FOLLOW_UP_WINDOW_MS,
	DEFAULT_BARGE_IN_ENABLED,
	DEFAULT_SPECULATIVE_SILENCE_MS,
	DEFAULT_SEMANTIC_ENDPOINTING_ENABLED,
	DEFAULT_ACOUSTIC_ENDPOINTING_ENABLED,
	DEFAULT_SUPPRESS_WAKE_WHILE_PEER_SPEAKS,
	DEFAULT_ACOUSTIC_ENDPOINT_THRESHOLD,
	DEFAULT_TURN_DETECTOR_MODEL_PATH,
	DEFAULT_TURN_DETECTOR_ENGINE,
	TURN_DETECTOR_ENGINE_ENUM_VALUES,
	DEFAULT_SPECULATIVE_TTS_ENABLED,
	DEFAULT_SATELLITE_SPECULATION_ENABLED,
	DEFAULT_SPECULATE_WITH_SKILLS,
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
	DEFAULT_PLAYBACK_PAUSE_ENABLED,
	DEFAULT_WORD_LEVEL_HEARD_ENABLED,
	DEFAULT_TTS_PACER_ENABLED,
	DEFAULT_TTS_PACER_MIN_REMAINING_MS,
	DEFAULT_TTS_PACER_MAX_CHARS,
	DEFAULT_ENDPOINT_INCOMPLETE_MS,
	DEFAULT_ENDPOINT_WAIT_MS,
	DEFAULT_FOLLOW_UP_LEAD_PAD_MS,
	DEFAULT_SENTENCE_SOFT_FLUSH_MIN_CHARS,
	DEFAULT_SENTENCE_FIRST_UNIT_MAX_WORDS,
	DEFAULT_SENTENCE_MEDIUM_FLUSH_CHARS,
	DEFAULT_SENTENCE_HARD_FLUSH_CHARS,
	DEFAULT_SENTENCE_FIRST_FLUSH_MAX_MS,
	DEFAULT_PIPELINE_MAX_QUEUE_DEPTH,
	DEFAULT_PIPELINE_EAGER_TTS_SENTENCES,
	DEFAULT_GRPC_UNARY_DEADLINE_MS,
	DEFAULT_GRPC_STREAM_IDLE_TIMEOUT_MS,
	DEFAULT_GRPC_STREAM_DEADLINE_MS,
	DEFAULT_PEER_STALE_AFTER_MS,
	DEFAULT_CONFIG_RELOAD_DRAIN_MS,
	DEFAULT_STT_POOL_EXECUTION_TIMEOUT_MS,
	DEFAULT_TTS_POOL_EXECUTION_TIMEOUT_MS,
	DEFAULT_MQTT_HOST,
	DEFAULT_MQTT_USERNAME,
	DEFAULT_MQTT_PASSWORD,
	DEFAULT_MQTT_TOPIC_ROOT,
	DEFAULT_AUDIO_CAPTURE_SAMPLE_RATE,
	DEFAULT_AUDIO_CAPTURE_BITS_PER_SAMPLE,
	DEFAULT_AUDIO_CAPTURE_CHANNELS,
	DEFAULT_AUDIO_CAPTURE_MAX_RECORDING_MS,
	WAKE_WORD_FRAMEWORK_ENUM_VALUES,
	WAKE_WORD_FRAMEWORK_ENUM,
	DEFAULT_MEMORY_WINDOW_TURNS,
	DEFAULT_MEMORY_MAX_AGE_MS,
	DEFAULT_LLM_CONCURRENCY,
	DEFAULT_REFLECTION_ONLY_WHEN_IDLE,
	DEFAULT_ENVIRONMENT_TIME_ENABLED,
	DEFAULT_REFLECTION_CONCURRENCY,
	DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	DEFAULT_REFLECTION_YIELD_TO_VOICE,
	DEFAULT_MAX_CONCURRENT_VOICE_REPLIES,
	DEFAULT_MAX_QUEUED_VOICE_REPLIES,
	DEFAULT_VOICE_QUEUE_TIMEOUT_MS,
	DEFAULT_OWN_CONFIG_TTL_MS,
	DEFAULT_WARMUP_ON_BOOT,
	DEFAULT_IS_HOSTED,
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
	INTERACTION_INPUT_TYPE_ENUM_VALUES,
	INTERACTION_INPUT_TYPE_ENUM,
	RESPONSE_TYPE_ENUM_VALUES,
	RESPONSE_TYPE_ENUM,
	INTERACTION_STATUS_ENUM_VALUES,
	INTERACTION_STATUS_ENUM,
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
	DEFAULT_AUDIO_PLAYBACK_VOLUME,
	DEFAULT_AUDIO_PLAYBACK_STREAMING_ENABLED,
	DEFAULT_PLAYBACK_WATCHDOG_GRACE_MS,
	DEFAULT_PLAYBACK_TRUNCATION_REPLAY_ENABLED,
	DEFAULT_PLAYBACK_TRUNCATION_REPLAY_THRESHOLD_MS,
	DEFAULT_FEEDBACK_SOUNDS_ENABLED,
	DEFAULT_ACK_SOUND_ENABLED,
	DEFAULT_ERROR_SOUND_ENABLED,
	DEFAULT_DONE_SOUND_ENABLED,
	DEFAULT_THINKING_SOUND_ENABLED,
	DEFAULT_ENDPOINT_SOUND_ENABLED,
	DEFAULT_ENDPOINT_SOUND_PATH,
	DEFAULT_ACK_SOUND_PATH,
	DEFAULT_ERROR_SOUND_PATH,
	DEFAULT_DONE_SOUND_PATH,
	DEFAULT_THINKING_SOUND_PATH,
	DEFAULT_QUANTIZATION,
	AUDIO_PLAYBACK_ENGINE_ENUM_VALUES,
	AUDIO_PLAYBACK_ENGINE_ENUM,
	MQTT_TYPE_ENUM_VALUES,
	MQTT_TYPE_ENUM,
	MQTT_PROTOCOL_ENUM,
	MQTT_PROTOCOL_ENUM_VALUES,
	CAPABILITY_ENUM_VALUES,
	SATELLITE_PROTOCOL_ENUM_VALUES,
	IMPLICIT_FEEDBACK_ENUM_VALUES,
	DEFAULT_SATELLITE_PROTOCOL,
	DEFAULT_SATELLITE_PORT,
	DEFAULT_SATELLITE_ACTIVE,
	DEFAULT_DESIRED_WAKE_WORDS,
	DEFAULT_SATELLITE_DESIRED_NUMBERS,
	DEFAULT_SATELLITE_FOLLOW_UP,
	DEFAULT_SATELLITE_FOLLOW_UP_NO_SPEECH_MS,
	DEFAULT_SATELLITE_PLAYBACK_DRAIN_MARGIN_MS,
	DEFAULT_SATELLITE_RUN_LISTENING_MAX_MS,
	DEFAULT_SATELLITE_FOLLOW_UP_REQUEST_MAX_MS,
	DEFAULT_SATELLITE_CAPTURE_HEAD_TRIM_MS,
	SKILL_PROTOCOL_ENUM_VALUES,
	MCP_TRANSPORT_ENUM_VALUES,
	SKILL_TRUST_TIER_ENUM_VALUES,
	DEFAULT_SKILL_TRUST_TIER,
	TOOL_RUN_STATUS_ENUM,
	TOOL_RUN_STATUS_ENUM_VALUES,
	ASYNC_FOLLOW_UP_POLICY_ENUM_VALUES,
	DEFAULT_ASYNC_FOLLOW_UP_POLICY,
	DEFAULT_ASYNC_FOLLOW_UP_MAX_WAIT_MS,
	DEFAULT_AGENT_REPEAT_WARN_AT,
	DEFAULT_AGENT_REPEAT_BLOCK_AT,
	DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN,
	DEFAULT_AGENT_RECENT_TOOLS_TURNS,
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
	CONFIRMATION_STATUS_ENUM,
	CONFIRMATION_STATUS_ENUM_VALUES,
	DEFAULT_AUTHORED_SPEECH_ENABLED,
	AGENT_PROMPT_MODE_ENUM_VALUES,
	DEFAULT_AGENT_PROMPT_MODE,
	SKILLS_ROUTING_ENUM_VALUES,
	DEFAULT_SKILLS_ROUTING,
	DEFAULT_INTENT_EMBED_THRESHOLD,
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
	DEFAULT_SKILL_PROTOCOL,
	DEFAULT_MCP_TRANSPORT_TYPE,
	DEFAULT_SKILL_MAX_RESULT_CHARS,
	DEFAULT_SKILL_TIMEOUT_MS,
	DEFAULT_SKILLS_ENGINE,
	DEFAULT_METRICS_SAMPLE_RESOURCES,
	DEFAULT_TURN_EVENTS_PERSIST,
	ANNOUNCEMENT_KIND_ENUM,
	ANNOUNCEMENT_KIND_ENUM_VALUES,
	ANNOUNCEMENT_DELIVERY_ENUM,
	ANNOUNCEMENT_DELIVERY_ENUM_VALUES,
} from "./constants"

export const DEFAULT_TIMESTAMP = sql`CURRENT_TIMESTAMP`
export const MS_TIMESTAMP = sql`(strftime('%Y-%m-%d %H:%M:%f','now'))`

export const hostNode = sqliteTable("host_node", {
	id: text("id").primaryKey(),
	nodeId: text("node_id").notNull(),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const domia = sqliteTable("domia", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	domiaKey: text("domia_key").notNull().unique(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	sessionIdTimeoutMs: integer("session_id_timeout_ms")
		.notNull()
		.default(300_000),
	memoryWindowTurns: integer("memory_window_turns")
		.notNull()
		.default(DEFAULT_MEMORY_WINDOW_TURNS),
	memoryMaxAgeMs: integer("memory_max_age_ms")
		.notNull()
		.default(DEFAULT_MEMORY_MAX_AGE_MS),
	maxConcurrentVoiceReplies: integer("max_concurrent_voice_replies")
		.notNull()
		.default(DEFAULT_MAX_CONCURRENT_VOICE_REPLIES),
	maxQueuedVoiceReplies: integer("max_queued_voice_replies")
		.notNull()
		.default(DEFAULT_MAX_QUEUED_VOICE_REPLIES),
	voiceQueueTimeoutMs: integer("voice_queue_timeout_ms")
		.notNull()
		.default(DEFAULT_VOICE_QUEUE_TIMEOUT_MS),
	ownConfigTtlMs: integer("own_config_ttl_ms")
		.notNull()
		.default(DEFAULT_OWN_CONFIG_TTL_MS),
	warmupOnBoot: integer("warmup_on_boot", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_WARMUP_ON_BOOT),
	isHosted: integer("is_hosted", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_IS_HOSTED),
	localIp: text("local_ip"),
	grpcPort: integer("grpc_port"),
	lastSeenAt: integer("last_seen_at"),
	peerNodeId: text("peer_node_id"),
	grpcUnaryDeadlineMs: integer("grpc_unary_deadline_ms")
		.notNull()
		.default(DEFAULT_GRPC_UNARY_DEADLINE_MS),
	grpcStreamIdleTimeoutMs: integer("grpc_stream_idle_timeout_ms")
		.notNull()
		.default(DEFAULT_GRPC_STREAM_IDLE_TIMEOUT_MS),
	grpcStreamDeadlineMs: integer("grpc_stream_deadline_ms")
		.notNull()
		.default(DEFAULT_GRPC_STREAM_DEADLINE_MS),
	peerStaleAfterMs: integer("peer_stale_after_ms")
		.notNull()
		.default(DEFAULT_PEER_STALE_AFTER_MS),
	configRevision: integer("config_revision").notNull().default(0),
	configReloadDrainMs: integer("config_reload_drain_ms")
		.notNull()
		.default(DEFAULT_CONFIG_RELOAD_DRAIN_MS),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const runtimeCapabilities = sqliteTable("runtime_capabilities", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.unique()
		.references(() => domia.id),
	wakeword: integer("wakeword", { mode: "boolean" }).notNull().default(false),
	record: integer("record", { mode: "boolean" }).notNull().default(false),
	stt: integer("stt", { mode: "boolean" }).notNull().default(false),
	intentDetection: integer("intent_detection", { mode: "boolean" })
		.notNull()
		.default(false),
	intentExecution: integer("intent_execution", { mode: "boolean" })
		.notNull()
		.default(false),
	promptGeneration: integer("prompt_generation", { mode: "boolean" })
		.notNull()
		.default(false),
	llm: integer("llm", { mode: "boolean" }).notNull().default(false),
	tts: integer("tts", { mode: "boolean" }).notNull().default(false),
	playback: integer("playback", { mode: "boolean" }).notNull().default(false),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const emotionState = sqliteTable("emotion_state", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.unique()
		.references(() => domia.id),
	joy: real("joy").notNull().default(0),
	sadness: real("sadness").notNull().default(0),
	anger: real("anger").notNull().default(0),
	fear: real("fear").notNull().default(0),
	trust: real("trust").notNull().default(0),
	disgust: real("disgust").notNull().default(0),
	anticipation: real("anticipation").notNull().default(0),
	surprise: real("surprise").notNull().default(0),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const emotionEvent = sqliteTable(
	"emotion_event",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		cause: text("cause").notNull(),
		delta: text("delta", { mode: "json" }).notNull(),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [index("idx_emotion_event_domia_created").on(t.domiaId, t.createdAt)],
)

export const memoryFact = sqliteTable(
	"memory_fact",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		subject: text("subject").notNull(),
		relation: text("relation").notNull(),
		value: text("value").notNull(),
		valueKey: text("value_key").notNull().default(""),
		confidence: real("confidence").notNull().default(0.7),
		kind: text("kind", { enum: FACT_KIND_ENUM_VALUES })
			.notNull()
			.default(DEFAULT_FACT_KIND),
		sourceInteractionId: text("source_interaction_id"),
		supersededAt: text("superseded_at"),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [
		unique().on(t.domiaId, t.subject, t.relation, t.valueKey),
		index("idx_memory_fact_domia_updated").on(t.domiaId, t.updatedAt),
		index("idx_memory_fact_domia_created").on(t.domiaId, t.createdAt),
	],
)

export const factEvidence = sqliteTable(
	"fact_evidence",
	{
		id: text("id").primaryKey(),
		factId: text("fact_id")
			.notNull()
			.references(() => memoryFact.id, { onDelete: "cascade" }),
		sourceInteractionId: text("source_interaction_id").notNull(),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [unique().on(t.factId, t.sourceInteractionId)],
)

export const knowledgeEntry = sqliteTable(
	"knowledge_entry",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		title: text("title").notNull(),
		content: text("content").notNull(),
		keywords: text("keywords", { mode: "json" }).$type<string[]>(),
		priority: integer("priority").notNull().default(0),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [index("idx_knowledge_domia_active").on(t.domiaId, t.isActive)],
)

export const memoryEpisode = sqliteTable(
	"memory_episode",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		sessionId: text("session_id").notNull(),
		summary: text("summary").notNull(),
		moodArc: text("mood_arc"),
		topics: text("topics", { mode: "json" }).$type<string[]>(),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [index("idx_episode_domia_created").on(t.domiaId, t.createdAt)],
)

export const userModel = sqliteTable("user_model", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.unique()
		.references(() => domia.id),
	summary: text("summary"),
	moodTendencies: text("mood_tendencies"),
	interests: text("interests", { mode: "json" }).$type<string[]>(),
	prefs: text("prefs", { mode: "json" }).$type<string[]>(),
	familiarity: real("familiarity").notNull().default(0),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const moduleSettings = sqliteTable("module_settings", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	emotionEngine: integer("emotion_engine", { mode: "boolean" }).notNull(),
	emotionCapture: integer("emotion_capture", { mode: "boolean" })
		.notNull()
		.default(true),
	memoryEngine: integer("memory_engine", { mode: "boolean" }).notNull(),
	factCapture: integer("fact_capture", { mode: "boolean" })
		.notNull()
		.default(true),
	factRecall: integer("fact_recall", { mode: "boolean" })
		.notNull()
		.default(true),
	environmentTimeEnabled: integer("environment_time_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_ENVIRONMENT_TIME_ENABLED),
	reflectionOnlyWhenIdle: integer("reflection_only_when_idle", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_REFLECTION_ONLY_WHEN_IDLE),
	reflectionConcurrency: integer("reflection_concurrency")
		.notNull()
		.default(DEFAULT_REFLECTION_CONCURRENCY),
	reflectionQueueMaxDepth: integer("reflection_queue_max_depth")
		.notNull()
		.default(DEFAULT_REFLECTION_QUEUE_MAX_DEPTH),
	reflectionYieldToVoice: integer("reflection_yield_to_voice", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_REFLECTION_YIELD_TO_VOICE),
	collectiveMind: integer("collective_mind", { mode: "boolean" }).notNull(),
	remoteAccessEngine: integer("remote_access_engine", {
		mode: "boolean",
	}).notNull(),
	narrativeEngine: integer("narrative_engine", { mode: "boolean" }).notNull(),
	identityEngine: integer("identity_engine", { mode: "boolean" }).notNull(),
	skillsEngine: integer("skills_engine", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_SKILLS_ENGINE),
	metricsSampleResources: integer("metrics_sample_resources", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_METRICS_SAMPLE_RESOURCES),
	turnEventsPersist: integer("turn_events_persist", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_TURN_EVENTS_PERSIST),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const characterProfile = sqliteTable("character_profile", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	personality: text("personality", {
		enum: PERSONALITY_ENUM_VALUES,
	})
		.notNull()
		.default(PERSONALITY_ENUM.NEUTRAL),
	language: text("language").notNull().default(DEFAULT_LANGUAGE),
	profession: text("profession", {
		enum: PROFESSION_ENUM_VALUES,
	})
		.notNull()
		.default(PROFESSION_ENUM.HOST),
	communicationStyle: text("communication_style", {
		enum: COMMUNICATION_STYLE_ENUM_VALUES,
	})
		.notNull()
		.default(COMMUNICATION_STYLE_ENUM.FRIENDLY),
	perceivedAge: text("perceived_age", {
		enum: PERCEIVED_AGE_ENUM_VALUES,
	})
		.notNull()
		.default(PERCEIVED_AGE_ENUM.ADULT),
	culturalBackground: text("cultural_background"),
	languagesSpoken: text("languages_spoken", { mode: "json" }),
	knowledgeDepth: text("knowledge_depth", {
		enum: KNOWLEDGE_DEPTH_ENUM_VALUES,
	})
		.notNull()
		.default(KNOWLEDGE_DEPTH_ENUM.INTERMEDIATE),
	interests: text("interests", { mode: "json" }),
	hobbies: text("hobbies", { mode: "json" }),
	skills: text("skills", { mode: "json" }),
	relationshipType: text("relationship_type", {
		enum: RELATIONSHIP_TYPE_ENUM_VALUES,
	})
		.notNull()
		.default(RELATIONSHIP_TYPE_ENUM.COMPANION),
	roleMode: text("role_mode", {
		enum: ROLE_MODE_ENUM_VALUES,
	})
		.notNull()
		.default(ROLE_MODE_ENUM.PASSIVE),
	emotionExpressionStyle: text("emotion_expression_style", {
		enum: EMOTION_EXPRESSION_STYLE_ENUM_VALUES,
	})
		.notNull()
		.default(DEFAULT_EMOTION_EXPRESSION_STYLE),
	voiceStyle: text("voice_style"),
	promptOverrides: text("prompt_overrides", { mode: "json" }),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

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
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

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
	anaphoraMaxAgeMs: integer("anaphora_max_age_ms")
		.notNull()
		.default(DEFAULT_ANAPHORA_MAX_AGE_MS),
	fastPathEnabled: integer("fast_path_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_FAST_PATH_ENABLED),
	fastPathMinCoverage: real("fast_path_min_coverage")
		.notNull()
		.default(DEFAULT_FAST_PATH_MIN_COVERAGE),
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
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const skillProvider = sqliteTable("skill_provider", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	protocol: text("protocol", { enum: SKILL_PROTOCOL_ENUM_VALUES })
		.notNull()
		.default(DEFAULT_SKILL_PROTOCOL),
	type: text("type", { enum: MCP_TRANSPORT_ENUM_VALUES })
		.notNull()
		.default(DEFAULT_MCP_TRANSPORT_TYPE),
	url: text("url").notNull(),
	description: text("description"),
	config: text("config", { mode: "json" }).$type<SkillProviderConfigType>(),
	descriptor: text("descriptor", {
		mode: "json",
	}).$type<DomiaSkillDescriptorType>(),
	auth: text("auth", { mode: "json" }).$type<SkillAuthType>(),
	toolsCache: text("tools_cache", { mode: "json" }).$type<SkillToolType[]>(),
	toolWhitelist: text("tool_whitelist", { mode: "json" }).$type<string[]>(),
	lastSyncAt: text("last_sync_at"),
	maxResultChars: integer("max_result_chars")
		.notNull()
		.default(DEFAULT_SKILL_MAX_RESULT_CHARS),
	timeout: integer("timeout_ms").notNull().default(DEFAULT_SKILL_TIMEOUT_MS),
	priority: integer("priority").notNull().default(0),
	trustTier: text("trust_tier", { enum: SKILL_TRUST_TIER_ENUM_VALUES })
		.notNull()
		.default(DEFAULT_SKILL_TRUST_TIER),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const toolRun = sqliteTable(
	"tool_run",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		interactionId: text("interaction_id").notNull(),
		tool: text("tool").notNull(),
		providerSlug: text("provider_slug"),
		argsHash: text("args_hash").notNull(),
		riskClass: text("risk_class"),
		policyDecision: text("policy_decision"),
		policySource: text("policy_source"),
		confirmationId: text("confirmation_id"),
		status: text("status", { enum: TOOL_RUN_STATUS_ENUM_VALUES })
			.notNull()
			.default(TOOL_RUN_STATUS_ENUM.DISPATCHED),
		durationMs: integer("duration_ms"),
		spokenAt: text("spoken_at"),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		settledAt: text("settled_at"),
	},
	(t) => [index("tool_run_interaction_idx").on(t.interactionId, t.status)],
)

export const pendingConfirmationRow = sqliteTable("pending_confirmation", {
	scope: text("scope").primaryKey(),
	domiaKey: text("domia_key").notNull(),
	tool: text("tool").notNull(),
	args: text("args", { mode: "json" })
		.$type<Record<string, unknown>>()
		.notNull(),
	resolvedArgs: text("resolved_args", { mode: "json" }).$type<Record<
		string,
		unknown
	> | null>(),
	summary: text("summary"),
	language: text("language"),
	reasked: integer("reasked", { mode: "boolean" }).notNull().default(false),
	expiresAt: integer("expires_at").notNull(),
	status: text("status", { enum: CONFIRMATION_STATUS_ENUM_VALUES })
		.notNull()
		.default(CONFIRMATION_STATUS_ENUM.PENDING),
	settledAt: text("settled_at"),
	settledBy: text("settled_by"),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const audioPlaybackConfig = sqliteTable("audio_playback_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", {
		enum: AUDIO_PLAYBACK_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(AUDIO_PLAYBACK_ENGINE_ENUM.SOX),
	volume: integer("volume").notNull().default(DEFAULT_AUDIO_PLAYBACK_VOLUME),
	streamingEnabled: integer("streaming_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_AUDIO_PLAYBACK_STREAMING_ENABLED),
	pauseEnabled: integer("pause_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_PLAYBACK_PAUSE_ENABLED),
	wordLevelHeardEnabled: integer("word_level_heard_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_WORD_LEVEL_HEARD_ENABLED),
	watchdogGraceMs: integer("watchdog_grace_ms")
		.notNull()
		.default(DEFAULT_PLAYBACK_WATCHDOG_GRACE_MS),
	truncationReplayEnabled: integer("truncation_replay_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_PLAYBACK_TRUNCATION_REPLAY_ENABLED),
	truncationReplayThresholdMs: integer("truncation_replay_threshold_ms")
		.notNull()
		.default(DEFAULT_PLAYBACK_TRUNCATION_REPLAY_THRESHOLD_MS),
	outputDevice: text("output_device"),
	feedbackSoundsEnabled: integer("feedback_sounds_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_FEEDBACK_SOUNDS_ENABLED),
	ackSoundEnabled: integer("ack_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_ACK_SOUND_ENABLED),
	errorSoundEnabled: integer("error_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_ERROR_SOUND_ENABLED),
	doneSoundEnabled: integer("done_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_DONE_SOUND_ENABLED),
	thinkingSoundEnabled: integer("thinking_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_THINKING_SOUND_ENABLED),
	endpointSoundEnabled: integer("endpoint_sound_enabled", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_ENDPOINT_SOUND_ENABLED),
	ackSoundPath: text("ack_sound_path")
		.notNull()
		.default(DEFAULT_ACK_SOUND_PATH),
	errorSoundPath: text("error_sound_path")
		.notNull()
		.default(DEFAULT_ERROR_SOUND_PATH),
	doneSoundPath: text("done_sound_path")
		.notNull()
		.default(DEFAULT_DONE_SOUND_PATH),
	thinkingSoundPath: text("thinking_sound_path")
		.notNull()
		.default(DEFAULT_THINKING_SOUND_PATH),
	endpointSoundPath: text("endpoint_sound_path")
		.notNull()
		.default(DEFAULT_ENDPOINT_SOUND_PATH),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const mqttConfig = sqliteTable("mqtt_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	type: text("type", { enum: MQTT_TYPE_ENUM_VALUES })
		.notNull()
		.default(MQTT_TYPE_ENUM.LOCAL),
	host: text("host").notNull().default(DEFAULT_MQTT_HOST),
	username: text("username").default(DEFAULT_MQTT_USERNAME),
	password: text("password").default(DEFAULT_MQTT_PASSWORD),
	qos: integer("qos").notNull().default(1),
	topicRoot: text("topic_root").notNull().default(DEFAULT_MQTT_TOPIC_ROOT),
	protocol: text("protocol", {
		enum: MQTT_PROTOCOL_ENUM_VALUES,
	})
		.notNull()
		.default(MQTT_PROTOCOL_ENUM.MQTT),
	port: integer("port").notNull().default(1883),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const interactionSessionTrace = sqliteTable(
	"interaction_session_trace",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		sessionId: text("session_id").notNull(),
		startedAt: text("started_at").notNull().default(DEFAULT_TIMESTAMP),
		lastUsedAt: text("last_used_at").notNull().default(DEFAULT_TIMESTAMP),
		timeoutMs: integer("session_id_timeout_ms").notNull().default(300_000),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [
		index("idx_session_trace_domia_lastused").on(t.domiaId, t.lastUsedAt),
	],
)

export const interactionTrace = sqliteTable(
	"interaction_trace",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		interactionSessionTraceId: text("interaction_session_trace_id")
			.notNull()
			.references(() => interactionSessionTrace.id),
		sessionId: text("session_id").notNull(),
		inputType: text("input_type", { enum: INTERACTION_INPUT_TYPE_ENUM_VALUES })
			.notNull()
			.default(INTERACTION_INPUT_TYPE_ENUM.VOICE),
		responseType: text("response_type", { enum: RESPONSE_TYPE_ENUM_VALUES })
			.notNull()
			.default(RESPONSE_TYPE_ENUM.VOICE),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		inputRaw: text("input_raw"),
		inputAudioPath: text("input_audio_path"),
		wakewordUsed: text("wakeword_used").notNull().default(DEFAULT_WAKE_WORD),
		sttResult: text("stt_result"),
		intentDecision: text("intent_decision"),
		intentMs: integer("intent_ms"),
		fastPathMs: integer("fast_path_ms"),
		agentDecisionMs: integer("agent_decision_ms"),
		agentToolMs: integer("agent_tool_ms"),
		agentFinalizeMs: integer("agent_finalize_ms"),
		skillProviderUsed: text("skill_provider_used"),
		skillPrompt: text("skill_prompt"),
		skillResponse: text("skill_response", { mode: "json" }).$type<
			ToolTraceEntryType[]
		>(),
		llmPrompt: text("llm_prompt"),
		llmResponse: text("llm_response"),
		heardReply: text("heard_reply"),
		ttsEngineUsed: text("tts_engine_used"),
		ttsAudioPath: text("tts_audio_path"),
		finalOutput: text("final_output"),
		emotionSnapshot: text("emotion_snapshot", { mode: "json" }),
		characterSnapshot: text("character_snapshot", { mode: "json" }),
		userEmotionSnapshot: text("user_emotion_snapshot", { mode: "json" }),
		sttMs: integer("stt_ms"),
		sttQueueMs: integer("stt_queue_ms"),
		llmMs: integer("llm_ms"),
		llmQueueMs: integer("llm_queue_ms"),
		llmPromptTokens: integer("llm_prompt_tokens"),
		llmCompletionTokens: integer("llm_completion_tokens"),
		llmTokensPerSec: real("llm_tokens_per_sec"),
		llmTtftMs: integer("llm_ttft_ms"),
		llmContextWindow: integer("llm_context_window"),
		llmFinishReason: text("llm_finish_reason"),
		llmRequestId: text("llm_request_id"),
		llmFreshTokens: integer("llm_fresh_tokens"),
		llmCachedTokens: integer("llm_cached_tokens"),
		transcriptionDelayMs: integer("transcription_delay_ms"),
		eouDelayMs: integer("eou_delay_ms"),
		endpointDebounceMs: integer("endpoint_debounce_ms"),
		speechEndAt: integer("speech_end_at"),
		endpointDecisionAt: integer("endpoint_decision_at"),
		sttFinalAt: integer("stt_final_at"),
		promptReadyAt: integer("prompt_ready_at"),
		llmQueuedAt: integer("llm_queued_at"),
		llmFirstTokenAt: integer("llm_first_token_at"),
		ttsFirstUnitAt: integer("tts_first_unit_at"),
		audioDeliveredAt: integer("audio_delivered_at"),
		audioAudibleAt: integer("audio_audible_at"),
		toolCallCount: integer("tool_call_count"),
		toolErrorCount: integer("tool_error_count"),
		inputAudioMs: integer("input_audio_ms"),
		ttsMs: integer("tts_ms"),
		ttsQueueMs: integer("tts_queue_ms"),
		ttfaMs: integer("ttfa_ms"),
		perceivedTtfaMs: integer("perceived_ttfa_ms"),
		llmFirstSentenceMs: integer("llm_first_sentence_ms"),
		ttsFirstChunkMs: integer("tts_first_chunk_ms"),
		rssMb: integer("rss_mb"),
		totalMs: integer("total_ms"),
		sttExecutorKey: text("stt_executor_key"),
		llmExecutorKey: text("llm_executor_key"),
		ttsExecutorKey: text("tts_executor_key"),
		sttModelUsed: text("stt_model_used"),
		llmModelUsed: text("llm_model_used"),
		ttsVoiceUsed: text("tts_voice_used"),
		wakeWordModelUsed: text("wake_word_model_used"),
		status: text("status", { enum: INTERACTION_STATUS_ENUM_VALUES })
			.notNull()
			.default(INTERACTION_STATUS_ENUM.OK),
		errorStep: text("error_step"),
		errorMessage: text("error_message"),
		satelliteId: text("satellite_id"),
		satelliteProtocol: text("satellite_protocol", {
			enum: SATELLITE_PROTOCOL_ENUM_VALUES,
		}),
		implicitFeedback: text("implicit_feedback", {
			enum: IMPLICIT_FEEDBACK_ENUM_VALUES,
		}),
		domiaSnapshot: text("domia_snapshot", { mode: "json" }),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [
		index("idx_trace_domia_created").on(t.domiaId, t.createdAt),
		index("idx_trace_session").on(t.interactionSessionTraceId),
	],
)

export const announcement = sqliteTable(
	"announcement",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		broadcastId: text("broadcast_id").notNull(),
		text: text("text").notNull().default(""),
		kind: text("kind", { enum: ANNOUNCEMENT_KIND_ENUM_VALUES })
			.notNull()
			.default(ANNOUNCEMENT_KIND_ENUM.TEXT),
		delivery: text("delivery", { enum: ANNOUNCEMENT_DELIVERY_ENUM_VALUES })
			.notNull()
			.default(ANNOUNCEMENT_DELIVERY_ENUM.DOMIA_VOICE),
		target: text("target"),
		audioPath: text("audio_path"),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [index("idx_announcement_domia_updated").on(t.domiaId, t.updatedAt)],
)

export const turnEvent = sqliteTable(
	"turn_event",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		interactionId: text("interaction_id").notNull(),
		type: text("type").notNull(),
		seq: integer("seq").notNull(),
		ts: integer("ts").notNull(),
		originDomiaKey: text("origin_domia_key"),
		executorDomiaKey: text("executor_domia_key"),
		satelliteId: text("satellite_id"),
		traceId: text("trace_id"),
		payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [
		index("idx_turn_event_interaction_seq").on(t.interactionId, t.seq),
		index("idx_turn_event_domia_created").on(t.domiaId, t.createdAt),
	],
)

export const capabilityDelegation = sqliteTable("capability_delegation", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	capability: text("capability", {
		enum: CAPABILITY_ENUM_VALUES,
	}).notNull(),
	delegateToDomiaId: text("delegate_to_domia_id").references(() => domia.id),
	delegateToDomiaKey: text("delegate_to_domia_key").notNull(),
	priority: integer("priority").notNull().default(0),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const satelliteConfig = sqliteTable(
	"satellite_config",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		satelliteId: text("satellite_id").notNull(),
		name: text("name"),
		host: text("host").notNull(),
		port: integer("port").notNull().default(DEFAULT_SATELLITE_PORT),
		encryptionKey: text("encryption_key"),
		protocol: text("protocol", { enum: SATELLITE_PROTOCOL_ENUM_VALUES })
			.notNull()
			.default(DEFAULT_SATELLITE_PROTOCOL),
		desiredWakeWords: text("desired_wake_words", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default(DEFAULT_DESIRED_WAKE_WORDS),
		desiredNumbers: text("desired_numbers", { mode: "json" })
			.$type<Record<string, number>>()
			.notNull()
			.default(DEFAULT_SATELLITE_DESIRED_NUMBERS),
		followUpEnabled: integer("follow_up_enabled", { mode: "boolean" })
			.notNull()
			.default(DEFAULT_SATELLITE_FOLLOW_UP),
		followUpNoSpeechMs: integer("follow_up_no_speech_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_FOLLOW_UP_NO_SPEECH_MS),
		playbackDrainMarginMs: integer("playback_drain_margin_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_PLAYBACK_DRAIN_MARGIN_MS),
		runListeningMaxMs: integer("run_listening_max_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_RUN_LISTENING_MAX_MS),
		followUpRequestMaxMs: integer("follow_up_request_max_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_FOLLOW_UP_REQUEST_MAX_MS),
		captureHeadTrimMs: integer("capture_head_trim_ms")
			.notNull()
			.default(DEFAULT_SATELLITE_CAPTURE_HEAD_TRIM_MS),
		desiredVolume: real("desired_volume"),
		livekitApiKey: text("livekit_api_key"),
		livekitApiSecret: text("livekit_api_secret"),
		livekitRoom: text("livekit_room"),
		isActive: integer("is_active", { mode: "boolean" })
			.notNull()
			.default(DEFAULT_SATELLITE_ACTIVE),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [unique().on(t.domiaId, t.satelliteId)],
)

export const domiaRelations = relations(domia, ({ one, many }) => ({
	runtimeCapabilities: one(runtimeCapabilities, {
		fields: [domia.id],
		references: [runtimeCapabilities.domiaId],
	}),
	emotionState: one(emotionState, {
		fields: [domia.id],
		references: [emotionState.domiaId],
	}),
	moduleSettings: many(moduleSettings),
	characterProfiles: many(characterProfile),
	emotionEvents: many(emotionEvent),
	memoryFacts: many(memoryFact),
	wakeWordConfigs: many(wakeWordConfig),
	sttConfigs: many(sttConfig),
	llmModelConfigs: many(llmModelConfig),
	ttsConfigs: many(ttsConfig),
	skillProviders: many(skillProvider),
	audioPlaybackConfigs: many(audioPlaybackConfig),
	mqttConfigs: many(mqttConfig),
	interactionTraces: many(interactionTrace),
	interactionSessionTraces: many(interactionSessionTrace),
	satellites: many(satelliteConfig),
	capabilityDelegations: many(capabilityDelegation, {
		relationName: "delegator",
	}),
	capabilityDelegatedToMe: many(capabilityDelegation, {
		relationName: "delegatee",
	}),
}))

export const runtimeCapabilitiesRelations = relations(
	runtimeCapabilities,
	({ one }) => ({
		domia: one(domia, {
			fields: [runtimeCapabilities.domiaId],
			references: [domia.id],
		}),
	}),
)

export const satelliteConfigRelations = relations(
	satelliteConfig,
	({ one }) => ({
		domia: one(domia, {
			fields: [satelliteConfig.domiaId],
			references: [domia.id],
		}),
	}),
)

export const emotionStateRelations = relations(emotionState, ({ one }) => ({
	domia: one(domia, {
		fields: [emotionState.domiaId],
		references: [domia.id],
	}),
}))

export const moduleSettingsRelations = relations(moduleSettings, ({ one }) => ({
	domia: one(domia, {
		fields: [moduleSettings.domiaId],
		references: [domia.id],
	}),
}))

export const characterProfileRelations = relations(
	characterProfile,
	({ one }) => ({
		domia: one(domia, {
			fields: [characterProfile.domiaId],
			references: [domia.id],
		}),
	}),
)

export const emotionEventRelations = relations(emotionEvent, ({ one }) => ({
	domia: one(domia, {
		fields: [emotionEvent.domiaId],
		references: [domia.id],
	}),
}))

export const memoryFactRelations = relations(memoryFact, ({ one }) => ({
	domia: one(domia, {
		fields: [memoryFact.domiaId],
		references: [domia.id],
	}),
}))

export const wakeWordConfigRelations = relations(wakeWordConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [wakeWordConfig.domiaId],
		references: [domia.id],
	}),
}))

export const sttConfigRelations = relations(sttConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [sttConfig.domiaId],
		references: [domia.id],
	}),
}))

export const llmModelConfigRelations = relations(llmModelConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [llmModelConfig.domiaId],
		references: [domia.id],
	}),
}))

export const ttsConfigRelations = relations(ttsConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [ttsConfig.domiaId],
		references: [domia.id],
	}),
}))

export const skillProviderRelations = relations(skillProvider, ({ one }) => ({
	domia: one(domia, {
		fields: [skillProvider.domiaId],
		references: [domia.id],
	}),
}))

export const audioPlaybackConfigRelations = relations(
	audioPlaybackConfig,
	({ one }) => ({
		domia: one(domia, {
			fields: [audioPlaybackConfig.domiaId],
			references: [domia.id],
		}),
	}),
)

export const mqttConfigRelations = relations(mqttConfig, ({ one }) => ({
	domia: one(domia, {
		fields: [mqttConfig.domiaId],
		references: [domia.id],
	}),
}))

export const interactionSessionTraceRelations = relations(
	interactionSessionTrace,
	({ one, many }) => ({
		domia: one(domia, {
			fields: [interactionSessionTrace.domiaId],
			references: [domia.id],
		}),
		interactionTraces: many(interactionTrace),
	}),
)

export const interactionTraceRelations = relations(
	interactionTrace,
	({ one }) => ({
		domia: one(domia, {
			fields: [interactionTrace.domiaId],
			references: [domia.id],
		}),
		interactionSessionTrace: one(interactionSessionTrace, {
			fields: [interactionTrace.interactionSessionTraceId],
			references: [interactionSessionTrace.id],
		}),
	}),
)

export const capabilityDelegationRelations = relations(
	capabilityDelegation,
	({ one }) => ({
		domia: one(domia, {
			fields: [capabilityDelegation.domiaId],
			references: [domia.id],
			relationName: "delegator",
		}),
		delegateToDomia: one(domia, {
			fields: [capabilityDelegation.delegateToDomiaId],
			references: [domia.id],
			relationName: "delegatee",
		}),
	}),
)

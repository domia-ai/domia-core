import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import type { BenchThresholdsType, VoiceFeelRuleType } from "../json-types"
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
	DEFAULT_LANGUAGE,
	DEFAULT_GRPC_UNARY_DEADLINE_MS,
	DEFAULT_GRPC_STREAM_IDLE_TIMEOUT_MS,
	DEFAULT_GRPC_STREAM_DEADLINE_MS,
	DEFAULT_PEER_STALE_AFTER_MS,
	DEFAULT_CONFIG_RELOAD_DRAIN_MS,
	DEFAULT_MODEL_INSTALL_ALLOWED_HOSTS,
	DEFAULT_HEARTBEAT_SIGNATURE_REQUIRED,
	DEFAULT_KNOWLEDGE_MAX_CHARS,
	DEFAULT_MESH_SECRET_GRACE_MS,
	DEFAULT_GRPC_TLS,
	DEFAULT_BENCH_TURNS,
	DEFAULT_BENCH_THRESHOLDS,
	DEFAULT_MEMORY_WINDOW_TURNS,
	DEFAULT_MEMORY_MAX_AGE_MS,
	DEFAULT_REFLECTION_ONLY_WHEN_IDLE,
	DEFAULT_ENVIRONMENT_TIME_ENABLED,
	DEFAULT_REFLECTION_CONCURRENCY,
	DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	DEFAULT_REFLECTION_YIELD_TO_VOICE,
	DEFAULT_REFLECTION_TIMEOUT_MS,
	DEFAULT_REFLECTION_IDLE_POLL_MS,
	DEFAULT_REFLECTION_IDLE_GRACE_MS,
	DEFAULT_REFLECTION_MAX_IDLE_WAIT_MS,
	DEFAULT_REFLECTION_SLOT_TIMEOUT_MS,
	DEFAULT_REFLECTION_YIELD_MAX_ATTEMPTS,
	DEFAULT_MEMORY_RECALL_INCLUDE_EXPIRED,
	DEFAULT_MAX_CONCURRENT_VOICE_REPLIES,
	DEFAULT_MAX_QUEUED_VOICE_REPLIES,
	DEFAULT_VOICE_QUEUE_TIMEOUT_MS,
	DEFAULT_OWN_CONFIG_TTL_MS,
	DEFAULT_WARMUP_ON_BOOT,
	DEFAULT_IS_HOSTED,
	DEFAULT_SKILLS_ENGINE,
	DEFAULT_METRICS_SAMPLE_RESOURCES,
	DEFAULT_TURN_EVENTS_PERSIST,
	DEFAULT_PROACTIVITY_ENGINE,
	DEFAULT_PROACTIVE_IDLE_NUDGE_ENABLED,
	DEFAULT_PROACTIVE_IDLE_NUDGE_AFTER_MS,
	DEFAULT_PROACTIVE_IDLE_NUDGE_MIN_INTERVAL_MS,
	DEFAULT_PROACTIVE_MAX_PER_HOUR,
	DEFAULT_PROACTIVE_MAX_PER_DAY,
	DEFAULT_PROACTIVE_CHIME_ENABLED,
	DEFAULT_PROACTIVE_DEFER_MAX_MS,
	DEFAULT_PROACTIVE_CRITICAL_DEFER_MAX_MS,
	DEFAULT_PROACTIVE_TICK_MS,
	DEFAULT_PROACTIVE_LEASE_MS,
	DEFAULT_PROACTIVE_MAX_ATTEMPTS,
	DEFAULT_PROACTIVE_RETRY_BACKOFF_MS,
	DEFAULT_VOICE_FEEL_AUTOTUNE_ENABLED,
	DEFAULT_VOICE_FEEL_WINDOW_TURNS,
	DEFAULT_VOICE_FEEL_MIN_TURNS,
	DEFAULT_VOICE_FEEL_TICK_MS,
	DEFAULT_VOICE_FEEL_DAILY_BUDGET,
	DEFAULT_VOICE_FEEL_COOLDOWN_MS,
	DEFAULT_VOICE_FEEL_RULES,
	DEFAULT_MESH_CONTROL_TOLERANCE_MS,
	DEFAULT_MESH_DROP_WARN_WINDOW_MS,
	DEFAULT_MODEL_DOWNLOAD_TIMEOUT_MS,
	DEFAULT_MODEL_INSTALL_MAX_BYTES,
	DEFAULT_MODEL_INSTALL_MAX_REDIRECTS,
	DEFAULT_MODEL_INSTALL_MAX_CONCURRENT_JOBS,
	DEFAULT_MODEL_JOB_RETENTION_MS,
} from "../constants"
import { DEFAULT_TIMESTAMP } from "./shared"

export const hostNode = sqliteTable("host_node", {
	id: text("id").primaryKey(),
	nodeId: text("node_id").notNull(),
	configRevision: integer("config_revision").notNull().default(0),
	meshControlToleranceMs: integer("mesh_control_tolerance_ms")
		.notNull()
		.default(DEFAULT_MESH_CONTROL_TOLERANCE_MS),
	meshDropWarnWindowMs: integer("mesh_drop_warn_window_ms")
		.notNull()
		.default(DEFAULT_MESH_DROP_WARN_WINDOW_MS),
	modelDownloadTimeoutMs: integer("model_download_timeout_ms")
		.notNull()
		.default(DEFAULT_MODEL_DOWNLOAD_TIMEOUT_MS),
	modelInstallMaxBytes: integer("model_install_max_bytes")
		.notNull()
		.default(DEFAULT_MODEL_INSTALL_MAX_BYTES),
	modelInstallMaxRedirects: integer("model_install_max_redirects")
		.notNull()
		.default(DEFAULT_MODEL_INSTALL_MAX_REDIRECTS),
	modelInstallMaxConcurrentJobs: integer("model_install_max_concurrent_jobs")
		.notNull()
		.default(DEFAULT_MODEL_INSTALL_MAX_CONCURRENT_JOBS),
	modelJobRetentionMs: integer("model_job_retention_ms")
		.notNull()
		.default(DEFAULT_MODEL_JOB_RETENTION_MS),
	publicAudioBaseUrl: text("public_audio_base_url"),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
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
	modelInstallAllowedHosts: text("model_install_allowed_hosts", {
		mode: "json",
	})
		.$type<string[]>()
		.notNull()
		.default(DEFAULT_MODEL_INSTALL_ALLOWED_HOSTS),
	heartbeatSignatureRequired: integer("heartbeat_signature_required", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_HEARTBEAT_SIGNATURE_REQUIRED),
	knowledgeMaxChars: integer("knowledge_max_chars")
		.notNull()
		.default(DEFAULT_KNOWLEDGE_MAX_CHARS),
	meshSecretGraceMs: integer("mesh_secret_grace_ms")
		.notNull()
		.default(DEFAULT_MESH_SECRET_GRACE_MS),
	grpcTls: integer("grpc_tls", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_GRPC_TLS),
	benchTurns: integer("bench_turns").notNull().default(DEFAULT_BENCH_TURNS),
	benchThresholds: text("bench_thresholds", { mode: "json" })
		.$type<BenchThresholdsType>()
		.notNull()
		.default(DEFAULT_BENCH_THRESHOLDS),
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
	memoryRecallIncludeExpired: integer("memory_recall_include_expired", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_MEMORY_RECALL_INCLUDE_EXPIRED),
	memoryFactMaxAgeDays: integer("memory_fact_max_age_days"),
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
	reflectionTimeoutMs: integer("reflection_timeout_ms")
		.notNull()
		.default(DEFAULT_REFLECTION_TIMEOUT_MS),
	reflectionIdlePollMs: integer("reflection_idle_poll_ms")
		.notNull()
		.default(DEFAULT_REFLECTION_IDLE_POLL_MS),
	reflectionIdleGraceMs: integer("reflection_idle_grace_ms")
		.notNull()
		.default(DEFAULT_REFLECTION_IDLE_GRACE_MS),
	reflectionMaxIdleWaitMs: integer("reflection_max_idle_wait_ms")
		.notNull()
		.default(DEFAULT_REFLECTION_MAX_IDLE_WAIT_MS),
	reflectionSlotTimeoutMs: integer("reflection_slot_timeout_ms")
		.notNull()
		.default(DEFAULT_REFLECTION_SLOT_TIMEOUT_MS),
	reflectionYieldMaxAttempts: integer("reflection_yield_max_attempts")
		.notNull()
		.default(DEFAULT_REFLECTION_YIELD_MAX_ATTEMPTS),
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
	proactivityEngine: integer("proactivity_engine", { mode: "boolean" })
		.notNull()
		.default(DEFAULT_PROACTIVITY_ENGINE),
	proactiveIdleNudgeEnabled: integer("proactive_idle_nudge_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_PROACTIVE_IDLE_NUDGE_ENABLED),
	proactiveIdleNudgeAfterMs: integer("proactive_idle_nudge_after_ms")
		.notNull()
		.default(DEFAULT_PROACTIVE_IDLE_NUDGE_AFTER_MS),
	proactiveIdleNudgeMinIntervalMs: integer(
		"proactive_idle_nudge_min_interval_ms",
	)
		.notNull()
		.default(DEFAULT_PROACTIVE_IDLE_NUDGE_MIN_INTERVAL_MS),
	proactiveQuietHoursStart: text("proactive_quiet_hours_start"),
	proactiveQuietHoursEnd: text("proactive_quiet_hours_end"),
	proactiveMaxPerHour: integer("proactive_max_per_hour")
		.notNull()
		.default(DEFAULT_PROACTIVE_MAX_PER_HOUR),
	proactiveMaxPerDay: integer("proactive_max_per_day")
		.notNull()
		.default(DEFAULT_PROACTIVE_MAX_PER_DAY),
	proactiveChimeEnabled: integer("proactive_chime_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_PROACTIVE_CHIME_ENABLED),
	proactiveDeferMaxMs: integer("proactive_defer_max_ms")
		.notNull()
		.default(DEFAULT_PROACTIVE_DEFER_MAX_MS),
	proactiveCriticalDeferMaxMs: integer("proactive_critical_defer_max_ms")
		.notNull()
		.default(DEFAULT_PROACTIVE_CRITICAL_DEFER_MAX_MS),
	proactiveTickMs: integer("proactive_tick_ms")
		.notNull()
		.default(DEFAULT_PROACTIVE_TICK_MS),
	proactiveLeaseMs: integer("proactive_lease_ms")
		.notNull()
		.default(DEFAULT_PROACTIVE_LEASE_MS),
	proactiveMaxAttempts: integer("proactive_max_attempts")
		.notNull()
		.default(DEFAULT_PROACTIVE_MAX_ATTEMPTS),
	proactiveRetryBackoffMs: integer("proactive_retry_backoff_ms")
		.notNull()
		.default(DEFAULT_PROACTIVE_RETRY_BACKOFF_MS),
	voiceFeelAutotuneEnabled: integer("voice_feel_autotune_enabled", {
		mode: "boolean",
	})
		.notNull()
		.default(DEFAULT_VOICE_FEEL_AUTOTUNE_ENABLED),
	voiceFeelWindowTurns: integer("voice_feel_window_turns")
		.notNull()
		.default(DEFAULT_VOICE_FEEL_WINDOW_TURNS),
	voiceFeelMinTurns: integer("voice_feel_min_turns")
		.notNull()
		.default(DEFAULT_VOICE_FEEL_MIN_TURNS),
	voiceFeelTickMs: integer("voice_feel_tick_ms")
		.notNull()
		.default(DEFAULT_VOICE_FEEL_TICK_MS),
	voiceFeelDailyBudget: integer("voice_feel_daily_budget")
		.notNull()
		.default(DEFAULT_VOICE_FEEL_DAILY_BUDGET),
	voiceFeelCooldownMs: integer("voice_feel_cooldown_ms")
		.notNull()
		.default(DEFAULT_VOICE_FEEL_COOLDOWN_MS),
	voiceFeelRules: text("voice_feel_rules", { mode: "json" })
		.$type<VoiceFeelRuleType[]>()
		.notNull()
		.default(DEFAULT_VOICE_FEEL_RULES),
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

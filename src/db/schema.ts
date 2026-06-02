import {
	sqliteTable,
	text,
	real,
	integer,
	unique,
} from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"

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
	DEFAULT_VAD_MODEL_PATH,
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
	DEFAULT_REFLECTION_CONCURRENCY,
	DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	DEFAULT_MAX_CONCURRENT_VOICE_REPLIES,
	DEFAULT_MAX_QUEUED_VOICE_REPLIES,
	DEFAULT_VOICE_QUEUE_TIMEOUT_MS,
	DEFAULT_OWN_CONFIG_TTL_MS,
	DEFAULT_STT_MODEL_NAME,
	DEFAULT_STT_MODEL_PATH,
	DEFAULT_STT_ENABLE_ENDPOINT,
	DEFAULT_STT_RULE1_MIN_TRAILING_SILENCE,
	DEFAULT_STT_RULE2_MIN_TRAILING_SILENCE,
	DEFAULT_STT_RULE3_MIN_UTTERANCE_LENGTH,
	DEFAULT_STT_NUM_THREADS,
	DEFAULT_STT_PROVIDER,
	DEFAULT_STT_DECODE_PADDING_MS,
	DEFAULT_STT_POOL_WARM_WORKERS,
	DEFAULT_STT_POOL_MAX_WORKERS,
	DEFAULT_STT_POOL_AUTO_SCALE_ENABLED,
	DEFAULT_STT_POOL_IDLE_TIMEOUT_MS,
	DEFAULT_STT_POOL_QUEUE_MAX_DEPTH,
	DEFAULT_STT_POOL_QUEUE_TIMEOUT_MS,
	DEFAULT_STT_WORKER_RECYCLE_AFTER_JOBS,
	INTERACTION_INPUT_TYPE_ENUM_VALUES,
	INTERACTION_INPUT_TYPE_ENUM,
	RESPONSE_TYPE_ENUM_VALUES,
	RESPONSE_TYPE_ENUM,
	DEFAULT_LLM_MODEL_NAME,
	DEFAULT_TTS_VOICE_NAME,
	DEFAULT_TTS_MODEL_PATH,
	DEFAULT_TTS_NUM_THREADS,
	DEFAULT_TTS_PROVIDER,
	DEFAULT_TTS_MAX_NUM_SENTENCES,
	DEFAULT_TTS_SILENCE_SCALE,
	DEFAULT_TTS_SPEED,
	DEFAULT_TTS_STREAMING_ENABLED,
	DEFAULT_TTS_POOL_WARM_WORKERS,
	DEFAULT_TTS_POOL_MAX_WORKERS,
	DEFAULT_TTS_POOL_AUTO_SCALE_ENABLED,
	DEFAULT_TTS_POOL_IDLE_TIMEOUT_MS,
	DEFAULT_TTS_POOL_QUEUE_MAX_DEPTH,
	DEFAULT_TTS_POOL_QUEUE_TIMEOUT_MS,
	DEFAULT_TTS_WORKER_RECYCLE_AFTER_JOBS,
	DEFAULT_AUDIO_PLAYBACK_VOLUME,
	DEFAULT_AUDIO_PLAYBACK_STREAMING_ENABLED,
	DEFAULT_QUANTIZATION,
	AUDIO_PLAYBACK_ENGINE_ENUM_VALUES,
	AUDIO_PLAYBACK_ENGINE_ENUM,
	MQTT_TYPE_ENUM_VALUES,
	MQTT_TYPE_ENUM,
	MQTT_PROTOCOL_ENUM,
	MQTT_PROTOCOL_ENUM_VALUES,
	CAPABILITY_ENUM_VALUES,
} from "./constants"

export const DEFAULT_TIMESTAMP = sql`CURRENT_TIMESTAMP`

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
	localIp: text("local_ip"),
	grpcPort: integer("grpc_port"),
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

export const emotionEvent = sqliteTable("emotion_event", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	cause: text("cause").notNull(),
	delta: text("delta", { mode: "json" }).notNull(),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

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
		confidence: real("confidence").notNull().default(0.7),
		sourceInteractionId: text("source_interaction_id"),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [unique().on(t.domiaId, t.subject, t.relation)],
)

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
	collectiveMind: integer("collective_mind", { mode: "boolean" }).notNull(),
	remoteAccessEngine: integer("remote_access_engine", {
		mode: "boolean",
	}).notNull(),
	narrativeEngine: integer("narrative_engine", { mode: "boolean" }).notNull(),
	identityEngine: integer("identity_engine", { mode: "boolean" }).notNull(),
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
	sensitivity: real("sensitivity").notNull().default(0.5),
	threshold: real("threshold").notNull().default(0.5),
	cooldown: real("cooldown").notNull().default(2.0),
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
	vadEngine: text("vad_engine").notNull().default(DEFAULT_VAD_ENGINE),
	vadModelPath: text("vad_model_path")
		.notNull()
		.default(DEFAULT_VAD_MODEL_PATH),
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
		.default(STT_ENGINE_ENUM.ZIPFORMER),
	modelName: text("model_name").notNull().default(DEFAULT_STT_MODEL_NAME),
	language: text("language").notNull().default(DEFAULT_LANGUAGE),
	modelPath: text("model_path").notNull().default(DEFAULT_STT_MODEL_PATH),
	quantization: text("quantization").notNull().default(DEFAULT_QUANTIZATION),
	silenceThreshold: real("silence_threshold"),
	bufferSize: integer("buffer_size"),
	timeoutMs: integer("timeout_ms").notNull().default(5000),
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
	useCompactPrompt: integer("use_compact_prompt", { mode: "boolean" })
		.notNull()
		.default(false),
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
	workerRecycleAfterJobs: integer("tts_worker_recycle_after_jobs")
		.notNull()
		.default(DEFAULT_TTS_WORKER_RECYCLE_AFTER_JOBS),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

export const mcpServerConfig = sqliteTable("mcp_server_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	url: text("url").notNull(),
	description: text("description"),
	timeout: integer("timeout_ms").notNull().default(2000),
	priority: integer("priority").notNull().default(0),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
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
	outputDevice: text("output_device"),
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
	host: text("host").notNull(),
	username: text("username"),
	password: text("password"),
	qos: integer("qos").notNull().default(1),
	topicRoot: text("topic_root").notNull(),
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
)

export const interactionTrace = sqliteTable("interaction_trace", {
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
	mcpServerUsed: text("mcp_server_used"),
	mcpPrompt: text("mcp_prompt"),
	mcpResponse: text("mcp_response", { mode: "json" }),
	llmPrompt: text("llm_prompt"),
	llmResponse: text("llm_response"),
	ttsEngineUsed: text("tts_engine_used"),
	ttsAudioPath: text("tts_audio_path"),
	finalOutput: text("final_output"),
	emotionSnapshot: text("emotion_snapshot", { mode: "json" }),
	characterSnapshot: text("character_snapshot", { mode: "json" }),
	userEmotionSnapshot: text("user_emotion_snapshot", { mode: "json" }),
	createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
})

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
	mcpServerConfigs: many(mcpServerConfig),
	audioPlaybackConfigs: many(audioPlaybackConfig),
	mqttConfigs: many(mqttConfig),
	interactionTraces: many(interactionTrace),
	interactionSessionTraces: many(interactionSessionTrace),
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

export const mcpServerConfigRelations = relations(
	mcpServerConfig,
	({ one }) => ({
		domia: one(domia, {
			fields: [mcpServerConfig.domiaId],
			references: [domia.id],
		}),
	}),
)

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

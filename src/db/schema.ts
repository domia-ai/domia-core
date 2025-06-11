import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core"
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
	DEFAULT_WAKE_WORD_MODEL,
	WAKE_WORD_FRAMEWORK_ENUM_VALUES,
	WAKE_WORD_FRAMEWORK_ENUM,
	DEFAULT_STT_MODEL_NAME,
	INTERACTION_INPUT_TYPE_ENUM_VALUES,
	INTERACTION_INPUT_TYPE_ENUM,
	DEFAULT_LLM_MODEL_NAME,
	DEFAULT_TTS_VOICE_NAME,
	AUDIO_PLAYBACK_ENGINE_ENUM_VALUES,
	AUDIO_PLAYBACK_ENGINE_ENUM,
} from "./constants"

export const DEFAULT_TIMESTAMP = sql`CURRENT_TIMESTAMP`

export const domia = sqliteTable("domia", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	domiaKey: text("domia_key").notNull().unique(),
	isActive: integer("is_active", { mode: "boolean" }).default(true),
	sessionIdTimeoutMs: integer("session_id_timeout_ms").default(300_000),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const emotionState = sqliteTable("emotion_state", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.unique()
		.references(() => domia.id),
	joy: real("joy").default(0),
	sadness: real("sadness").default(0),
	anger: real("anger").default(0),
	fear: real("fear").default(0),
	trust: real("trust").default(0),
	disgust: real("disgust").default(0),
	anticipation: real("anticipation").default(0),
	surprise: real("surprise").default(0),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const emotionEvent = sqliteTable("emotion_event", {
	id: text("id").primaryKey(),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	cause: text("cause").notNull(),
	delta: text("delta", { mode: "json" }).notNull(),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const moduleSettings = sqliteTable("module_settings", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	emotionEngine: integer("emotion_engine", { mode: "boolean" }).notNull(),
	memoryEngine: integer("memory_engine", { mode: "boolean" }).notNull(),
	collectiveMind: integer("collective_mind", { mode: "boolean" }).notNull(),
	remoteAccessEngine: integer("remote_access_engine", {
		mode: "boolean",
	}).notNull(),
	narrativeEngine: integer("narrative_engine", { mode: "boolean" }).notNull(),
	identityEngine: integer("identity_engine", { mode: "boolean" }).notNull(),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const characterProfile = sqliteTable("character_profile", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	personality: text("personality", {
		enum: PERSONALITY_ENUM_VALUES,
	}).default(PERSONALITY_ENUM.NEUTRAL),
	language: text("language").default(DEFAULT_LANGUAGE),
	profession: text("profession", {
		enum: PROFESSION_ENUM_VALUES,
	}).default(PROFESSION_ENUM.HOST),
	communicationStyle: text("communication_style", {
		enum: COMMUNICATION_STYLE_ENUM_VALUES,
	}).default(COMMUNICATION_STYLE_ENUM.FRIENDLY),
	perceivedAge: text("perceived_age", {
		enum: PERCEIVED_AGE_ENUM_VALUES,
	}).default(PERCEIVED_AGE_ENUM.ADULT),
	culturalBackground: text("cultural_background"),
	languagesSpoken: text("languages_spoken", { mode: "json" }),
	knowledgeDepth: text("knowledge_depth", {
		enum: KNOWLEDGE_DEPTH_ENUM_VALUES,
	}).default(KNOWLEDGE_DEPTH_ENUM.INTERMEDIATE),
	interests: text("interests", { mode: "json" }),
	hobbies: text("hobbies", { mode: "json" }),
	skills: text("skills", { mode: "json" }),
	relationshipType: text("relationship_type", {
		enum: RELATIONSHIP_TYPE_ENUM_VALUES,
	}).default(RELATIONSHIP_TYPE_ENUM.COMPANION),
	roleMode: text("role_mode", {
		enum: ROLE_MODE_ENUM_VALUES,
	}).default(ROLE_MODE_ENUM.PASSIVE),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const wakeWordConfig = sqliteTable("wake_word_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", {
		enum: WAKE_WORD_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(WAKE_WORD_ENGINE_ENUM.OPEN_WAKE_WORD),
	wakeWord: text("wake_word").notNull().default(DEFAULT_WAKE_WORD),
	sensitivity: real("sensitivity").default(0.5),
	threshold: real("threshold").default(0.5),
	cooldown: real("cooldown").default(2.0),
	framework: text("framework", {
		enum: WAKE_WORD_FRAMEWORK_ENUM_VALUES,
	}).default(WAKE_WORD_FRAMEWORK_ENUM.ONNX),
	model: text("model").notNull().default(DEFAULT_WAKE_WORD_MODEL),
	customModelPath: text("custom_model_path"),
	inputDeviceIndex: integer("device").notNull().default(0),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const sttConfig = sqliteTable("stt_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", { enum: STT_ENGINE_ENUM_VALUES })
		.notNull()
		.default(STT_ENGINE_ENUM.VOSK),
	modelName: text("model_name").notNull().default(DEFAULT_STT_MODEL_NAME),
	language: text("language").default(DEFAULT_LANGUAGE),
	modelPath: text("model_path"),
	silenceThreshold: real("silence_threshold"),
	bufferSize: integer("buffer_size"),
	timeoutMs: integer("timeout_ms").default(5000),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const llmModelConfig = sqliteTable("llm_model_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", { enum: LLM_ENGINE_ENUM_VALUES })
		.notNull()
		.default(LLM_ENGINE_ENUM.OLLAMA),
	modelName: text("model_name").notNull().default(DEFAULT_LLM_MODEL_NAME),
	temperature: real("temperature").default(DEFAULT_LLM_MODEL_TEMPERATURE),
	contextWindow: integer("context_window").default(
		DEFAULT_LLM_MODEL_CONTEXT_WINDOW,
	),
	useCompactPrompt: integer("use_compact_prompt", { mode: "boolean" }).default(
		false,
	),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const ttsConfig = sqliteTable("tts_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", {
		enum: TTS_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(TTS_ENGINE_ENUM.PIPER),
	voiceName: text("voice_name").notNull().default(DEFAULT_TTS_VOICE_NAME),
	language: text("language").default(DEFAULT_LANGUAGE),
	pitch: real("pitch").default(1),
	speed: real("speed").default(1),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const mcpServerConfig = sqliteTable("mcp_server_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	url: text("url").notNull(),
	description: text("description"),
	timeout: integer("timeout_ms").default(2000),
	priority: integer("priority").default(0),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const audioPlaybackConfig = sqliteTable("audio_playback_config", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(false),
	domiaId: text("domia_id")
		.notNull()
		.references(() => domia.id),
	engine: text("engine", {
		enum: AUDIO_PLAYBACK_ENGINE_ENUM_VALUES,
	})
		.notNull()
		.default(AUDIO_PLAYBACK_ENGINE_ENUM.SOX),
	volume: integer("volume").default(100),
	outputDevice: text("output_device"),
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const interactionSessionTrace = sqliteTable(
	"interaction_session_trace",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		sessionId: text("session_id").notNull(),
		startedAt: text("started_at").default(DEFAULT_TIMESTAMP),
		lastUsedAt: text("last_used_at").default(DEFAULT_TIMESTAMP),
		timeoutMs: integer("session_id_timeout_ms").default(300_000),
		createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
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
	isActive: integer("is_active", { mode: "boolean" }).default(true),
	inputRaw: text("input_raw"),
	inputAudioPath: text("input_audio_path"),
	wakewordUsed: text("wakeword_used").default(DEFAULT_WAKE_WORD),
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
	createdAt: text("created_at").default(DEFAULT_TIMESTAMP),
	updatedAt: text("updated_at").default(DEFAULT_TIMESTAMP),
})

export const domiaRelations = relations(domia, ({ one, many }) => ({
	emotionState: one(emotionState, {
		fields: [domia.id],
		references: [emotionState.domiaId],
	}),
	moduleSettings: many(moduleSettings),
	characterProfiles: many(characterProfile),
	emotionEvents: many(emotionEvent),
	wakeWordConfigs: many(wakeWordConfig),
	sttConfigs: many(sttConfig),
	llmModelConfigs: many(llmModelConfig),
	ttsConfigs: many(ttsConfig),
	mcpServerConfigs: many(mcpServerConfig),
	audioPlaybackConfigs: many(audioPlaybackConfig),
	interactionTraces: many(interactionTrace),
	interactionSessionTraces: many(interactionSessionTrace),
}))

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

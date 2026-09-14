import {
	sqliteTable,
	text,
	real,
	integer,
	index,
} from "drizzle-orm/sqlite-core"
import type { ToolTraceEntryType, VoiceFeelFeaturesType } from "../json-types"
import {
	DEFAULT_WAKE_WORD,
	INTERACTION_INPUT_TYPE_ENUM_VALUES,
	INTERACTION_INPUT_TYPE_ENUM,
	RESPONSE_TYPE_ENUM_VALUES,
	RESPONSE_TYPE_ENUM,
	INTERACTION_STATUS_ENUM_VALUES,
	INTERACTION_STATUS_ENUM,
	SATELLITE_PROTOCOL_ENUM_VALUES,
	IMPLICIT_FEEDBACK_ENUM_VALUES,
} from "../constants"
import { DEFAULT_TIMESTAMP } from "./shared"
import { domia } from "./identity"

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
		abortReason: text("abort_reason"),
		traceId: text("trace_id"),
		domiaSnapshot: text("domia_snapshot", { mode: "json" }),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
		updatedAt: text("updated_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [
		index("idx_trace_domia_created").on(t.domiaId, t.createdAt),
		index("idx_trace_session").on(t.interactionSessionTraceId),
		index("idx_trace_trace_id").on(t.traceId),
	],
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

export const voiceFeelAdjustment = sqliteTable(
	"voice_feel_adjustment",
	{
		id: text("id").primaryKey(),
		domiaId: text("domia_id")
			.notNull()
			.references(() => domia.id),
		rule: text("rule").notNull(),
		section: text("section").notNull(),
		field: text("field").notNull(),
		fromValue: real("from_value").notNull(),
		toValue: real("to_value").notNull(),
		features: text("features", { mode: "json" }).$type<VoiceFeelFeaturesType>(),
		sampleSize: integer("sample_size").notNull(),
		confidence: real("confidence").notNull(),
		configRevision: integer("config_revision"),
		appliedAt: text("applied_at"),
		revertedAt: text("reverted_at"),
		createdAt: text("created_at").notNull().default(DEFAULT_TIMESTAMP),
	},
	(t) => [index("idx_voice_feel_domia_created").on(t.domiaId, t.createdAt)],
)

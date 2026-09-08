export const OTEL_TRACER_NAME = "domia-core"
export const OTEL_TURN_LRU_MAX = 256

export const SPAN_NAMES = {
	TURN: "domia.turn",
	STT: "domia.stt",
	INTENT: "domia.intent",
	LLM: "domia.llm",
	TOOL: "domia.tool",
	TTS: "domia.tts",
	PLAYBACK: "domia.playback",
	STAGE_PREFIX: "domia.stage.",
} as const

export const ATTR = {
	INTERACTION_ID: "domia.interaction_id",
	ORIGIN_DOMIA_KEY: "domia.origin_domia_key",
	EXECUTOR_DOMIA_KEY: "domia.executor_domia_key",
	SATELLITE_ID: "domia.satellite_id",
	TRACE_ID: "domia.trace_id",
	TURN_INPUT_TYPE: "domia.turn.input_type",
	TURN_SOURCE: "domia.turn.source",
	TURN_STATUS: "domia.turn.status",
	TURN_INCOMPLETE: "domia.turn.incomplete",
	TURN_TTFA_MS: "domia.turn.ttfa_ms",
	TURN_PERCEIVED_TTFA_MS: "domia.turn.perceived_ttfa_ms",
	TURN_TOTAL_MS: "domia.turn.total_ms",
	TURN_ABORT_REASON: "domia.turn.abort_reason",
	TURN_FAILED_STEP: "domia.turn.failed_step",
	TURN_ERROR_CODE: "domia.turn.error_code",
	STT_TRANSCRIPT_CHARS: "domia.stt.transcript_chars",
	STT_SPECULATIVE: "domia.stt.speculative",
	INTENT_DECISION: "domia.intent.decision",
	LLM_QUEUE_MS: "domia.llm.queue_ms",
	LLM_FIRST_SENTENCE_MS: "domia.llm.first_sentence_ms",
	TOOL_PROVIDER: "domia.tool.provider",
	TOOL_RISK_CLASS: "domia.tool.risk_class",
	TOOL_POLICY_DECISION: "domia.tool.policy_decision",
	TOOL_STATUS: "domia.tool.status",
	TTS_FIRST_CHUNK_MS: "domia.tts.first_chunk_ms",
	PLAYBACK_STATUS: "domia.playback.status",
	PLAYBACK_LOCAL: "domia.playback.played_locally",
	STAGE_STATUS: "domia.stage.status",
	GEN_AI_OPERATION_NAME: "gen_ai.operation.name",
	GEN_AI_USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
	GEN_AI_USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
	GEN_AI_RESPONSE_FINISH_REASONS: "gen_ai.response.finish_reasons",
	GEN_AI_TOOL_NAME: "gen_ai.tool.name",
} as const

export const GEN_AI_OPERATION_CHAT = "chat"
export const GEN_AI_OPERATION_TOOL = "execute_tool"

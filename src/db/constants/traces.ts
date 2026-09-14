import type { BenchThresholdsType } from "../json-types"

export const DEFAULT_BENCH_TURNS = 3
export const HARDWARE_CLASS_ENUM = {
	PI: "pi",
	SBC: "sbc",
	NVIDIA_JETSON: "nvidia-jetson",
	APPLE_SILICON: "apple-silicon",
	DESKTOP: "desktop",
} as const
export const HARDWARE_CLASS_ENUM_VALUES = [
	HARDWARE_CLASS_ENUM.PI,
	HARDWARE_CLASS_ENUM.SBC,
	HARDWARE_CLASS_ENUM.NVIDIA_JETSON,
	HARDWARE_CLASS_ENUM.APPLE_SILICON,
	HARDWARE_CLASS_ENUM.DESKTOP,
] as const
export const BENCH_STAGE_ENUM = {
	STT: "stt_ms",
	LLM_TTFT: "llm_ttft_ms",
	LLM: "llm_ms",
	TTS: "tts_ms",
	TOOL: "tool_ms",
	TOTAL: "total_ms",
} as const
export const BENCH_STAGE_ENUM_VALUES = [
	BENCH_STAGE_ENUM.STT,
	BENCH_STAGE_ENUM.LLM_TTFT,
	BENCH_STAGE_ENUM.LLM,
	BENCH_STAGE_ENUM.TTS,
	BENCH_STAGE_ENUM.TOOL,
	BENCH_STAGE_ENUM.TOTAL,
] as const
export const DEFAULT_BENCH_THRESHOLDS: BenchThresholdsType = {
	pi: {
		stt_ms: 1500,
		llm_ttft_ms: 1500,
		llm_ms: 6000,
		tts_ms: 2500,
		tool_ms: 3000,
		total_ms: 9000,
	},
	sbc: {
		stt_ms: 1500,
		llm_ttft_ms: 1500,
		llm_ms: 6000,
		tts_ms: 2500,
		tool_ms: 3000,
		total_ms: 9000,
	},
	"nvidia-jetson": {
		stt_ms: 800,
		llm_ttft_ms: 900,
		llm_ms: 4000,
		tts_ms: 1500,
		tool_ms: 2500,
		total_ms: 6000,
	},
	"apple-silicon": {
		stt_ms: 800,
		llm_ttft_ms: 800,
		llm_ms: 4000,
		tts_ms: 1500,
		tool_ms: 2500,
		total_ms: 6000,
	},
	desktop: {
		stt_ms: 1000,
		llm_ttft_ms: 1000,
		llm_ms: 5000,
		tts_ms: 2000,
		tool_ms: 3000,
		total_ms: 7000,
	},
}
export const INTERACTION_INPUT_TYPE_ENUM = {
	VOICE: "VOICE",
	TEXT: "TEXT",
} as const
export const INTERACTION_INPUT_TYPE_ENUM_VALUES = [
	INTERACTION_INPUT_TYPE_ENUM.VOICE,
	INTERACTION_INPUT_TYPE_ENUM.TEXT,
] as const
export const RESPONSE_TYPE_ENUM = {
	TEXT: "text",
	VOICE: "voice",
} as const
export const RESPONSE_TYPE_ENUM_VALUES = [
	RESPONSE_TYPE_ENUM.TEXT,
	RESPONSE_TYPE_ENUM.VOICE,
] as const
export const INTERACTION_STATUS_ENUM = {
	OK: "ok",
	FAILED: "failed",
	ABORTED: "aborted",
	NO_SPEECH: "no_speech",
} as const
export const INTERACTION_STATUS_ENUM_VALUES = [
	INTERACTION_STATUS_ENUM.OK,
	INTERACTION_STATUS_ENUM.FAILED,
	INTERACTION_STATUS_ENUM.ABORTED,
	INTERACTION_STATUS_ENUM.NO_SPEECH,
] as const
export const IMPLICIT_FEEDBACK_ENUM = {
	BARGE_IN: "barge_in",
	REPHRASE: "rephrase",
	SATISFIED: "satisfied",
} as const
export const IMPLICIT_FEEDBACK_ENUM_VALUES = [
	IMPLICIT_FEEDBACK_ENUM.BARGE_IN,
	IMPLICIT_FEEDBACK_ENUM.REPHRASE,
	IMPLICIT_FEEDBACK_ENUM.SATISFIED,
] as const
export const DEFAULT_METRICS_SAMPLE_RESOURCES = true
export const DEFAULT_TURN_EVENTS_PERSIST = true
export const DEFAULT_TURN_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_TURN_EVENT_MAX_ROWS_PER_DOMIA = 5000
export const DEFAULT_TMP_AUDIO_TTL_MS = 86_400_000
export const DEFAULT_TMP_SWEEP_INTERVAL_MS = 3_600_000
export const DEFAULT_RETENTION_SWEEP_INTERVAL_MS = 3_600_000
export const DEFAULT_TRACE_MAX_AGE_MS = 90 * 86_400_000
export const DEFAULT_TRACE_MAX_ROWS_PER_DOMIA = 5_000
export const DEFAULT_TRACE_MAX_ROWS_GLOBAL = 50_000

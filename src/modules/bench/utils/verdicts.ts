import {
	BENCH_STAGE_ENUM,
	BENCH_STAGE_ENUM_VALUES,
	DEFAULT_BENCH_THRESHOLDS,
	STT_ENGINE_ENUM,
	TTS_ENGINE_ENUM,
} from "@/db/constants"
import type {
	BenchStageType,
	BenchThresholdsType,
	HardwareClassType,
} from "@/db/json-types"
import { percentile } from "@/utils"
import type {
	BenchStageSamplesType,
	BenchStageThresholdsType,
	BenchStageVerdictType,
	BenchSuggestionContextType,
	BenchTurnRowType,
	BenchVerdictType,
} from "../types"

const isExternalStt = (engine: string | null): boolean =>
	engine === STT_ENGINE_ENUM.NEMO_SPEECH ||
	engine === STT_ENGINE_ENUM.OPENAI_COMPATIBLE

export const suggestionFor = (
	stage: BenchStageType,
	ctx: BenchSuggestionContextType,
): string => {
	switch (stage) {
		case BENCH_STAGE_ENUM.STT:
			return isExternalStt(ctx.sttEngine)
				? "stt.modelName → a smaller model on the STT server, or stt.numThreads ↑"
				: "stt.engine → NEMO_SPEECH (external server) or a smaller stt.modelName"
		case BENCH_STAGE_ENUM.LLM_TTFT:
			return "llm.useCompactPrompt → true, llm.contextWindow ↓, or a smaller llm.modelName"
		case BENCH_STAGE_ENUM.LLM:
			return "llm.numPredict ↓ or a smaller llm.modelName"
		case BENCH_STAGE_ENUM.TTS:
			return ctx.ttsEngine === TTS_ENGINE_ENUM.VITS
				? "tts.numThreads ↑ or tts.maxNumSentences ↓"
				: "tts.engine → VITS (lighter) or tts.streamingEnabled → true"
		case BENCH_STAGE_ENUM.TOOL:
			return "llm.toolNumPredict ↓, llm.agentBudgetMs ↓, or llm.toolShortlistMax ↓"
		case BENCH_STAGE_ENUM.TOTAL:
			return "tune the slowest stage above; llm.numPredict ↓ is the biggest lever"
	}
}

export const resolveThresholds = (
	thresholds: Partial<BenchThresholdsType> | null | undefined,
	hardwareClass: HardwareClassType,
): BenchStageThresholdsType => ({
	...DEFAULT_BENCH_THRESHOLDS[hardwareClass],
	...(thresholds?.[hardwareClass] ?? {}),
})

const STAGE_FIELDS: Record<BenchStageType, keyof BenchTurnRowType> = {
	stt_ms: "sttMs",
	llm_ttft_ms: "llmTtftMs",
	llm_ms: "llmMs",
	tts_ms: "ttsMs",
	tool_ms: "toolMs",
	total_ms: "totalMs",
}

export const collectSamples = (
	rows: BenchTurnRowType[],
): BenchStageSamplesType => {
	const samples: BenchStageSamplesType = {}
	for (const stage of BENCH_STAGE_ENUM_VALUES) {
		const xs = rows
			.filter((r) => r.status === "ok")
			.map((r) => r[STAGE_FIELDS[stage]])
			.filter((v): v is number => typeof v === "number")
		if (xs.length) samples[stage] = xs
	}
	return samples
}

const OPTIONAL_STAGES = new Set<BenchStageType>([BENCH_STAGE_ENUM.TOOL])

export const computeStageVerdicts = (
	samples: BenchStageSamplesType,
	thresholds: BenchStageThresholdsType,
	ctx: BenchSuggestionContextType,
): BenchStageVerdictType[] =>
	BENCH_STAGE_ENUM_VALUES.flatMap((stage): BenchStageVerdictType[] => {
		const xs = samples[stage] ?? []
		const thresholdMs = thresholds[stage]
		if (xs.length === 0) {
			if (OPTIONAL_STAGES.has(stage)) return []
			return [
				{
					stage,
					verdict: "failed",
					samples: 0,
					p50: null,
					p95: null,
					thresholdMs,
				},
			]
		}
		const p95 = percentile(xs, 95)
		const verdict: BenchVerdictType = p95 > thresholdMs ? "slow" : "ok"
		return [
			{
				stage,
				verdict,
				samples: xs.length,
				p50: percentile(xs, 50),
				p95,
				thresholdMs,
				...(verdict === "slow"
					? { suggestion: suggestionFor(stage, ctx) }
					: {}),
			},
		]
	})

export const overallVerdict = (
	stages: BenchStageVerdictType[],
	failedTurns: number,
): BenchVerdictType => {
	if (failedTurns > 0 || stages.some((s) => s.verdict === "failed"))
		return "failed"
	return stages.some((s) => s.verdict === "slow") ? "slow" : "ok"
}

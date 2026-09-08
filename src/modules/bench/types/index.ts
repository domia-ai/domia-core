import type { BenchStageType, HardwareClassType } from "@/db/json-types"
import type { SelectInteractionTraceType } from "@/db/types"
import type { ConfigHealthType } from "@/modules/config"

export type BenchVerdictType = "ok" | "slow" | "failed"

export type BenchTurnStatusType = "ok" | "failed" | "skipped"

export type HardwareInfoType = {
	hardwareClass: HardwareClassType
	hardwareLabel: string
	platform: string
	cpu: string
	cores: number
	totalMemGb: number
}

export type BenchStageThresholdsType = Record<BenchStageType, number>

export type BenchStageSamplesType = Partial<Record<BenchStageType, number[]>>

export type BenchSuggestionContextType = {
	sttEngine: string | null
	ttsEngine: string | null
}

export type BenchStageVerdictType = {
	stage: BenchStageType
	verdict: BenchVerdictType
	samples: number
	p50: number | null
	p95: number | null
	thresholdMs: number
	suggestion?: string
}

export type BenchTurnRowType = {
	id: string
	interactionId: string | null
	status: BenchTurnStatusType
	transcript: string
	sttMs: number | null
	llmTtftMs: number | null
	llmMs: number | null
	ttsMs: number | null
	toolMs: number | null
	totalMs: number | null
	error?: string
}

export type BenchTurnCountsType = {
	requested: number
	completed: number
	failed: number
	skipped: number
}

export type BenchRunOptionsType = {
	turns?: number
}

export type BenchRunResultType = {
	ok: boolean
	verdict: BenchVerdictType
	hardware: HardwareInfoType
	turns: BenchTurnCountsType
	durationMs: number
	startedAt: string
	stages: BenchStageVerdictType[]
	rows: BenchTurnRowType[]
	health: ConfigHealthType
}

export type BenchCorpusEntryType = {
	id: string
	text: string
}

export type BenchCorpusType = {
	golden: BenchCorpusEntryType[]
}

export type BenchTraceRowType = Pick<
	SelectInteractionTraceType,
	| "status"
	| "sttResult"
	| "sttMs"
	| "llmTtftMs"
	| "llmMs"
	| "ttsMs"
	| "agentToolMs"
	| "totalMs"
>

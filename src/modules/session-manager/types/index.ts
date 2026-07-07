import { type InsertInteractionTraceType } from "@/db"
import type { RecentTurnType } from "@/modules/prompt-context-builder"

export type RecentTurnsAndMoodsType = {
	recentTurns: RecentTurnType[]
	userMoodTrend: string[]
}

export type NewInteractionDataType = Omit<
	InsertInteractionTraceType,
	"id" | "domiaId" | "sessionId" | "interactionSessionTraceId"
>

export type LatencyPercentilesType = {
	count: number
	p50: number | null
	p90: number | null
	min: number | null
	max: number | null
}

export type LatencyStatsType = {
	sampleSize: number
	ttfa: LatencyPercentilesType
	perceivedTtfa: LatencyPercentilesType
	stt: LatencyPercentilesType
	llm: LatencyPercentilesType
	llmQueue: LatencyPercentilesType
	tts: LatencyPercentilesType
	ttsFirstChunk: LatencyPercentilesType
	rssMb: LatencyPercentilesType
	bySatellite: Record<string, LatencyPercentilesType>
}

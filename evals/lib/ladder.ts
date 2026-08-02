import { existsSync } from "fs"
import path from "path"
import { queryAll, queryOne } from "./db"
import type { EndpointAckStatsType, LadderDeltasType } from "../types"

export const LADDER_STAGE_COLS = [
	"speech_end_at",
	"endpoint_decision_at",
	"stt_final_at",
	"prompt_ready_at",
	"llm_queued_at",
	"llm_first_token_at",
	"tts_first_unit_at",
	"audio_delivered_at",
	"audio_audible_at",
] as const

const DELTA_DEFS: [string, string, string][] = [
	["d_endpoint_ms", "speech_end_at", "endpoint_decision_at"],
	["d_stt_final_ms", "endpoint_decision_at", "stt_final_at"],
	["d_prompt_ready_ms", "stt_final_at", "prompt_ready_at"],
	["d_llm_queued_ms", "prompt_ready_at", "llm_queued_at"],
	["d_first_token_ms", "llm_queued_at", "llm_first_token_at"],
	["d_tts_first_unit_ms", "llm_first_token_at", "tts_first_unit_at"],
	["d_audio_delivered_ms", "tts_first_unit_at", "audio_delivered_at"],
	["d_audible_ms", "audio_delivered_at", "audio_audible_at"],
]

const num = (v: unknown): number | null => (typeof v === "number" ? v : null)

export const ladderDeltas = (
	row: Record<string, unknown>,
): LadderDeltasType => {
	const out: LadderDeltasType = {}
	for (const [name, from, to] of DELTA_DEFS) {
		const a = num(row[from])
		const b = num(row[to])
		out[name] = a != null && b != null ? b - a : null
	}
	const speechEnd = num(row.speech_end_at)
	const delivered = num(row.audio_delivered_at)
	out.d_speech_to_delivered_ms =
		speechEnd != null && delivered != null ? delivered - speechEnd : null
	return out
}

export const ladderViolations = (row: Record<string, unknown>): string[] => {
	const issues: string[] = []
	let prevName: string | null = null
	let prevVal: number | null = null
	for (const col of LADDER_STAGE_COLS) {
		const v = num(row[col])
		if (v === null) continue
		if (v === 0) issues.push(`${col} is 0 (must be null when unavailable)`)
		if (prevVal != null && v < prevVal)
			issues.push(`${col} (${v}) < ${prevName} (${prevVal})`)
		prevName = col
		prevVal = v
	}
	return issues
}

export const endpointAckStats = (
	interactionId: string,
): EndpointAckStatsType => {
	const rows = queryAll<{ type: string; seq: number }>(
		"SELECT type, seq FROM turn_event WHERE interaction_id = ? AND type IN ('endpoint.accepted', 'stt.final') ORDER BY seq",
		[interactionId],
	)
	const acks = rows.filter((r) => r.type === "endpoint.accepted")
	const sttFinal = rows.find((r) => r.type === "stt.final")
	return {
		ackCount: acks.length,
		beforeSttFinal:
			acks.length > 0 && sttFinal ? acks[0].seq < sttFinal.seq : null,
	}
}

export const wasSpeculationCommitted = (interactionId: string): boolean =>
	(queryOne<{ n: number }>(
		"SELECT count(*) AS n FROM turn_event WHERE interaction_id = ? AND type = 'speculation.committed'",
		[interactionId],
	)?.n ?? 0) > 0

export const uniqueArtifactPath = (dir: string, label: string): string => {
	let candidate = path.join(dir, `${label}.json`)
	let i = 2
	while (existsSync(candidate)) {
		candidate = path.join(dir, `${label}-${i}.json`)
		i += 1
	}
	return candidate
}

import Database from "better-sqlite3"
import { env } from "./env"
import { sleep } from "./http"
import type { EvalTurnRecordType, LadderRowType } from "../types"

const POLL_INTERVAL_MS = 250

const openDb = (): Database.Database =>
	new Database(env.EVAL_DB, { readonly: true, fileMustExist: true })

export const execWrite = (sql: string, params: unknown[] = []): void => {
	const db = new Database(env.EVAL_DB, { fileMustExist: true })
	try {
		db.prepare(sql).run(...params)
	} finally {
		db.close()
	}
}

export const queryAll = <T>(sql: string, params: unknown[] = []): T[] => {
	const db = openDb()
	try {
		return db.prepare(sql).all(...params) as T[]
	} finally {
		db.close()
	}
}

export const queryOne = <T>(
	sql: string,
	params: unknown[] = [],
): T | undefined => {
	const db = openDb()
	try {
		return db.prepare(sql).get(...params) as T | undefined
	} finally {
		db.close()
	}
}

export const ladder = (interactionId: string): LadderRowType[] =>
	queryAll<LadderRowType>(
		"SELECT type, payload FROM turn_event WHERE interaction_id = ? ORDER BY created_at, id",
		[interactionId],
	)

export const pollEventSince = async (
	sinceIso: string,
	type: string,
	timeoutMs = 10000,
): Promise<string | null> => {
	const since = sinceIso.replace("T", " ").slice(0, 19)
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const row = queryOne<{ interaction_id: string }>(
			"SELECT interaction_id FROM turn_event WHERE type = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1",
			[type, since],
		)
		if (row) return row.interaction_id
		await sleep(100)
	}
	return null
}

const readRecord = (
	interactionId: string,
	needsTool: boolean,
): EvalTurnRecordType | null => {
	const db = openDb()
	try {
		const row = db
			.prepare(
				`SELECT intent_decision, tool_call_count, llm_ms, ttfa_ms, agent_decision_ms, agent_tool_ms, agent_finalize_ms, status, skill_response, llm_prompt
				 FROM interaction_trace WHERE id = ?`,
			)
			.get(interactionId) as
			| {
					intent_decision: string | null
					tool_call_count: number | null
					llm_ms: number | null
					ttfa_ms: number | null
					agent_decision_ms: number | null
					agent_tool_ms: number | null
					agent_finalize_ms: number | null
					status: string | null
					skill_response: string | null
					llm_prompt: string | null
			  }
			| undefined
		if (!row) return null
		const skillResponse = row.skill_response
			? (JSON.parse(row.skill_response) as unknown[])
			: null
		const hasResolved =
			Array.isArray(skillResponse) &&
			skillResponse.some(
				(e) =>
					e !== null &&
					typeof e === "object" &&
					"resolvedArgs" in (e as Record<string, unknown>),
			)
		if (!row.status) return null
		if (needsTool && (row.tool_call_count ?? 0) > 0 && !hasResolved) return null
		const events = db
			.prepare(
				`SELECT type, seq, payload FROM turn_event WHERE interaction_id = ? ORDER BY seq`,
			)
			.all(interactionId) as {
			type: string
			seq: number
			payload: string | null
		}[]
		if (!events.some((e) => e.type === "turn.completed")) return null
		return {
			interactionId,
			reply: "",
			intentDecision: row.intent_decision,
			toolCallCount: row.tool_call_count,
			llmMs: row.llm_ms,
			ttfaMs: row.ttfa_ms,
			agentDecisionMs: row.agent_decision_ms,
			agentToolMs: row.agent_tool_ms,
			agentFinalizeMs: row.agent_finalize_ms,
			status: row.status,
			skillResponse,
			llmPrompt: row.llm_prompt,
			events,
		}
	} finally {
		db.close()
	}
}

export const configSnapshot = (): Record<string, string> => {
	const llm = queryOne<{ v: string }>(
		"SELECT model_name || ' · routing=' || skills_routing || ' · matcher=' || matcher_engine AS v FROM llm_model_config WHERE is_active = 1 LIMIT 1",
	)
	const stt = queryOne<{ v: string }>(
		"SELECT engine AS v FROM stt_config LIMIT 1",
	)
	const tts = queryOne<{ v: string }>(
		"SELECT engine || ' thr=' || num_threads || ' speed=' || speed AS v FROM tts_config LIMIT 1",
	)
	const flags = queryOne<{ v: string }>(
		"SELECT 'emotion=' || emotion_engine || ' capture=' || emotion_capture || ' memory=' || memory_engine || ' facts=' || fact_capture || '/' || fact_recall || ' skills=' || skills_engine AS v FROM module_settings LIMIT 1",
	)
	return {
		llm: llm?.v ?? "",
		stt: stt?.v ?? "",
		tts: tts?.v ?? "",
		flags: flags?.v ?? "",
	}
}

export const pollRecord = async (
	interactionId: string,
	needsTool: boolean,
): Promise<EvalTurnRecordType | null> => {
	const start = Date.now()
	let last: EvalTurnRecordType | null = null
	while (Date.now() - start < env.EVAL_POLL_TIMEOUT_MS) {
		last = readRecord(interactionId, needsTool)
		if (last) return last
		await sleep(POLL_INTERVAL_MS)
	}
	return readRecord(interactionId, false) ?? last
}

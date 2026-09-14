import { execWrite, queryAll, queryOne } from "./db"
import { env } from "./env"
import { postConfigRefresh, resetConversation, sleep } from "./http"
import type { SeedFactType } from "../types"

const CONVERSATION_TABLES = [
	"turn_event",
	"interaction_trace",
	"interaction_session_trace",
	"memory_fact",
	"memory_episode",
	"user_model",
	"announcement",
]

export const factRows = (): SeedFactType[] =>
	queryAll<SeedFactType>(
		`SELECT subject, relation, value FROM memory_fact
		 WHERE domia_id = (SELECT id FROM domia WHERE domia_key = ?)
		   AND superseded_at IS NULL AND confidence >= 0.35`,
		[env.EVAL_DOMIA_KEY],
	)

export const factMatches = (
	rows: { subject: string; value: string }[],
	ref: { subject?: string; value: string },
): boolean =>
	rows.some(
		(r) =>
			r.value.toLowerCase().includes(ref.value.toLowerCase()) &&
			(!ref.subject ||
				r.subject.toLowerCase().includes(ref.subject.toLowerCase())),
	)

export const isolateConversation = async (): Promise<void> => {
	const domiaId = queryOne<{ id: string }>(
		"SELECT id FROM domia WHERE domia_key = ?",
		[env.EVAL_DOMIA_KEY],
	)?.id
	if (!domiaId) return
	const clear = (): void => {
		for (const table of CONVERSATION_TABLES)
			execWrite(`DELETE FROM ${table} WHERE domia_id = ?`, [domiaId])
	}
	clear()
	await resetConversation()
	for (let i = 0; i < 6; i++) {
		await sleep(1000)
		clear()
		if (factRows().length === 0) break
	}
	await postConfigRefresh()
}

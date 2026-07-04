import { sql } from "drizzle-orm"

import {
	dbClient,
	DEFAULT_RETENTION_SWEEP_INTERVAL_MS,
	DEFAULT_TRACE_MAX_AGE_MS,
	DEFAULT_TRACE_MAX_ROWS_PER_DOMIA,
	DEFAULT_TRACE_MAX_ROWS_GLOBAL,
	DEFAULT_EMOTION_EVENT_MAX_AGE_MS,
	DEFAULT_EMOTION_EVENT_MAX_ROWS_PER_DOMIA,
	DEFAULT_ANNOUNCEMENT_MAX_AGE_MS,
	DEFAULT_MEMORY_FACT_MAX_ROWS_PER_DOMIA,
} from "@/db"
import { appLogger } from "@/utils"

const ageModifier = (maxAgeMs: number): string =>
	`-${Math.round(maxAgeMs / 1000)} seconds`

const deleteOlderThan = (
	table: string,
	column: string,
	maxAgeMs: number,
): number => {
	const res = dbClient.run(
		sql.raw(
			`DELETE FROM ${table} WHERE ${column} < datetime('now', '${ageModifier(maxAgeMs)}')`,
		),
	)
	return res.changes ?? 0
}

const deleteBeyondPerDomiaCap = (
	table: string,
	orderColumn: string,
	cap: number,
): number => {
	const res = dbClient.run(
		sql.raw(
			`DELETE FROM ${table} WHERE id IN (
				SELECT id FROM (
					SELECT id, ROW_NUMBER() OVER (
						PARTITION BY domia_id ORDER BY ${orderColumn} DESC
					) AS rn FROM ${table}
				) WHERE rn > ${cap}
			)`,
		),
	)
	return res.changes ?? 0
}

const deleteBeyondGlobalCap = (
	table: string,
	orderColumn: string,
	cap: number,
): number => {
	const res = dbClient.run(
		sql.raw(
			`DELETE FROM ${table} WHERE id IN (
				SELECT id FROM ${table} ORDER BY ${orderColumn} DESC LIMIT -1 OFFSET ${cap}
			)`,
		),
	)
	return res.changes ?? 0
}

const deleteOrphanSessionTraces = (): number => {
	const res = dbClient.run(
		sql.raw(
			`DELETE FROM interaction_session_trace WHERE id NOT IN (
				SELECT DISTINCT interaction_session_trace_id FROM interaction_trace
			)`,
		),
	)
	return res.changes ?? 0
}

const sweep = (): void => {
	try {
		let removed = 0
		removed += deleteOlderThan(
			"interaction_trace",
			"created_at",
			DEFAULT_TRACE_MAX_AGE_MS,
		)
		removed += deleteBeyondPerDomiaCap(
			"interaction_trace",
			"created_at",
			DEFAULT_TRACE_MAX_ROWS_PER_DOMIA,
		)
		removed += deleteBeyondGlobalCap(
			"interaction_trace",
			"created_at",
			DEFAULT_TRACE_MAX_ROWS_GLOBAL,
		)
		removed += deleteOlderThan(
			"emotion_event",
			"created_at",
			DEFAULT_EMOTION_EVENT_MAX_AGE_MS,
		)
		removed += deleteBeyondPerDomiaCap(
			"emotion_event",
			"created_at",
			DEFAULT_EMOTION_EVENT_MAX_ROWS_PER_DOMIA,
		)
		removed += deleteOlderThan(
			"announcement",
			"created_at",
			DEFAULT_ANNOUNCEMENT_MAX_AGE_MS,
		)
		removed += deleteBeyondPerDomiaCap(
			"memory_fact",
			"updated_at",
			DEFAULT_MEMORY_FACT_MAX_ROWS_PER_DOMIA,
		)
		removed += deleteOrphanSessionTraces()
		if (removed > 0) {
			appLogger.info(`🧹 retention swept ${removed} stale row(s)`)
		}
	} catch (err) {
		appLogger.warn("retention sweep failed", { err })
	}
}

export const setupRetention = (): void => {
	sweep()
	const timer = setInterval(sweep, DEFAULT_RETENTION_SWEEP_INTERVAL_MS)
	timer.unref()
}

import {
	sql,
	lt,
	gt,
	inArray,
	notInArray,
	desc,
	getTableName,
} from "drizzle-orm"
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"

import {
	dbClient,
	interactionTrace,
	emotionEvent,
	announcement,
	memoryFact,
	memoryEpisode,
	turnEvent,
	interactionSessionTrace,
	DEFAULT_TRACE_MAX_AGE_MS,
	DEFAULT_TRACE_MAX_ROWS_PER_DOMIA,
	DEFAULT_TRACE_MAX_ROWS_GLOBAL,
	DEFAULT_EMOTION_EVENT_MAX_AGE_MS,
	DEFAULT_EMOTION_EVENT_MAX_ROWS_PER_DOMIA,
	DEFAULT_ANNOUNCEMENT_MAX_AGE_MS,
	DEFAULT_MEMORY_FACT_MAX_ROWS_PER_DOMIA,
	DEFAULT_MEMORY_EPISODE_MAX_AGE_MS,
	DEFAULT_MEMORY_EPISODE_MAX_ROWS_PER_DOMIA,
	DEFAULT_TURN_EVENT_MAX_AGE_MS,
	DEFAULT_TURN_EVENT_MAX_ROWS_PER_DOMIA,
	type DBClientOrTxType,
} from "@/db"

const secondsAgo = (maxAgeMs: number): string =>
	`-${Math.round(maxAgeMs / 1000)} seconds`

const pruneOlderThan = (
	table: SQLiteTable,
	dateColumn: SQLiteColumn,
	maxAgeMs: number,
	client: DBClientOrTxType,
): number =>
	client
		.delete(table)
		.where(lt(dateColumn, sql`datetime('now', ${secondsAgo(maxAgeMs)})`))
		.run().changes ?? 0

const prunePerDomiaCap = (
	table: SQLiteTable,
	idColumn: SQLiteColumn,
	domiaColumn: SQLiteColumn,
	orderColumn: SQLiteColumn,
	cap: number,
	client: DBClientOrTxType,
): number => {
	const ranked = client
		.select({
			id: idColumn,
			rn: sql<number>`row_number() over (partition by ${domiaColumn} order by ${orderColumn} desc)`.as(
				"rn",
			),
		})
		.from(table)
		.as("ranked")
	const overflow = client
		.select({ id: ranked.id })
		.from(ranked)
		.where(gt(ranked.rn, cap))
	return (
		client.delete(table).where(inArray(idColumn, overflow)).run().changes ?? 0
	)
}

const pruneGlobalCap = (
	table: SQLiteTable,
	idColumn: SQLiteColumn,
	orderColumn: SQLiteColumn,
	cap: number,
	client: DBClientOrTxType,
): number => {
	const keep = client
		.select({ id: idColumn })
		.from(table)
		.orderBy(desc(orderColumn))
		.limit(cap)
	return (
		client.delete(table).where(notInArray(idColumn, keep)).run().changes ?? 0
	)
}

const dbAdapter = {
	pruneStaleRows: (
		client: DBClientOrTxType = dbClient,
	): Record<string, number> => {
		const counts: Record<string, number> = {}
		const add = (table: SQLiteTable, removed: number): void => {
			const key = getTableName(table)
			counts[key] = (counts[key] ?? 0) + removed
		}
		add(
			interactionTrace,
			pruneOlderThan(
				interactionTrace,
				interactionTrace.createdAt,
				DEFAULT_TRACE_MAX_AGE_MS,
				client,
			),
		)
		add(
			interactionTrace,
			prunePerDomiaCap(
				interactionTrace,
				interactionTrace.id,
				interactionTrace.domiaId,
				interactionTrace.createdAt,
				DEFAULT_TRACE_MAX_ROWS_PER_DOMIA,
				client,
			),
		)
		add(
			interactionTrace,
			pruneGlobalCap(
				interactionTrace,
				interactionTrace.id,
				interactionTrace.createdAt,
				DEFAULT_TRACE_MAX_ROWS_GLOBAL,
				client,
			),
		)
		add(
			emotionEvent,
			pruneOlderThan(
				emotionEvent,
				emotionEvent.createdAt,
				DEFAULT_EMOTION_EVENT_MAX_AGE_MS,
				client,
			),
		)
		add(
			emotionEvent,
			prunePerDomiaCap(
				emotionEvent,
				emotionEvent.id,
				emotionEvent.domiaId,
				emotionEvent.createdAt,
				DEFAULT_EMOTION_EVENT_MAX_ROWS_PER_DOMIA,
				client,
			),
		)
		add(
			announcement,
			pruneOlderThan(
				announcement,
				announcement.createdAt,
				DEFAULT_ANNOUNCEMENT_MAX_AGE_MS,
				client,
			),
		)
		add(
			memoryFact,
			prunePerDomiaCap(
				memoryFact,
				memoryFact.id,
				memoryFact.domiaId,
				memoryFact.updatedAt,
				DEFAULT_MEMORY_FACT_MAX_ROWS_PER_DOMIA,
				client,
			),
		)
		add(
			memoryEpisode,
			pruneOlderThan(
				memoryEpisode,
				memoryEpisode.createdAt,
				DEFAULT_MEMORY_EPISODE_MAX_AGE_MS,
				client,
			),
		)
		add(
			memoryEpisode,
			prunePerDomiaCap(
				memoryEpisode,
				memoryEpisode.id,
				memoryEpisode.domiaId,
				memoryEpisode.createdAt,
				DEFAULT_MEMORY_EPISODE_MAX_ROWS_PER_DOMIA,
				client,
			),
		)
		add(
			turnEvent,
			pruneOlderThan(
				turnEvent,
				turnEvent.createdAt,
				DEFAULT_TURN_EVENT_MAX_AGE_MS,
				client,
			),
		)
		add(
			turnEvent,
			prunePerDomiaCap(
				turnEvent,
				turnEvent.id,
				turnEvent.domiaId,
				turnEvent.createdAt,
				DEFAULT_TURN_EVENT_MAX_ROWS_PER_DOMIA,
				client,
			),
		)
		return counts
	},
	deleteOrphanSessionTraces: (client: DBClientOrTxType = dbClient): number =>
		client
			.delete(interactionSessionTrace)
			.where(
				notInArray(
					interactionSessionTrace.id,
					client
						.selectDistinct({ id: interactionTrace.interactionSessionTraceId })
						.from(interactionTrace),
				),
			)
			.run().changes ?? 0,
}

export default dbAdapter

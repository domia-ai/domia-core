import { eq, desc, and, gte, asc } from "drizzle-orm"

import {
	dbClient,
	emotionState,
	emotionEvent,
	type DBClientOrTxType,
	type InsertEmotionStateType,
	type InsertEmotionEventType,
	DEFAULT_TIMESTAMP,
} from "@/db"

const dbAdapter = {
	upsertEmotionState: (
		data: InsertEmotionStateType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(emotionState)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: emotionState.id,
				set: { ...data, updatedAt: DEFAULT_TIMESTAMP },
				where: eq(emotionState.domiaId, data.domiaId),
			}),
	createEmotionEvent: (
		data: InsertEmotionEventType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(emotionEvent).values(data),
	getRecentEmotionEvents: (
		domiaId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.emotionEvent.findMany({
			where: eq(emotionEvent.domiaId, domiaId),
			orderBy: desc(emotionEvent.createdAt),
			limit,
		}),
	getEmotionEventsSince: (
		domiaId: string,
		since: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.emotionEvent.findMany({
			where: and(
				eq(emotionEvent.domiaId, domiaId),
				gte(emotionEvent.createdAt, since),
			),
			orderBy: asc(emotionEvent.createdAt),
			limit,
		}),
	getLastEmotionEventAt: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.emotionEvent.findFirst({
			where: eq(emotionEvent.domiaId, domiaId),
			orderBy: desc(emotionEvent.createdAt),
			columns: { createdAt: true },
		}),
}

export default dbAdapter

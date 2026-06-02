import { eq, desc } from "drizzle-orm"

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
				set: data,
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
}

export default dbAdapter

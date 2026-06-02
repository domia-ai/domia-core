import { eq, desc } from "drizzle-orm"

import {
	dbClient,
	memoryFact,
	type DBClientOrTxType,
	type InsertMemoryFactType,
	DEFAULT_TIMESTAMP,
} from "@/db"

const dbAdapter = {
	upsertFact: (
		data: InsertMemoryFactType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(memoryFact)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: [memoryFact.domiaId, memoryFact.subject, memoryFact.relation],
				set: {
					value: data.value,
					confidence: data.confidence,
					sourceInteractionId: data.sourceInteractionId,
					updatedAt: DEFAULT_TIMESTAMP,
				},
			}),
	getRecentFacts: (
		domiaId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.memoryFact.findMany({
			where: eq(memoryFact.domiaId, domiaId),
			orderBy: desc(memoryFact.updatedAt),
			limit,
		}),
}

export default dbAdapter

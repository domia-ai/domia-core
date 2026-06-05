import { eq, desc, and, gte, asc } from "drizzle-orm"

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
	getFactsSince: (
		domiaId: string,
		since: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.memoryFact.findMany({
			where: and(
				eq(memoryFact.domiaId, domiaId),
				gte(memoryFact.updatedAt, since),
			),
			orderBy: asc(memoryFact.updatedAt),
			limit,
		}),
	getLastFactAt: (domiaId: string, client: DBClientOrTxType = dbClient) =>
		client.query.memoryFact.findFirst({
			where: eq(memoryFact.domiaId, domiaId),
			orderBy: desc(memoryFact.updatedAt),
			columns: { updatedAt: true },
		}),
}

export default dbAdapter

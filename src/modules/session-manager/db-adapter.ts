import { eq, desc } from "drizzle-orm"

import {
	dbClient,
	interactionTrace,
	interactionSessionTrace,
	type DBClientOrTxType,
	type InsertInteractionTraceType,
	type InsertInteractionSessionTraceType,
	type UpdateInteractionTraceType,
	type UpdateInteractionSessionTraceType,
	DEFAULT_TIMESTAMP,
} from "@/db"

const dbAdapter = {
	insertInteractionTrace: (
		data: InsertInteractionTraceType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(interactionTrace).values(data),
	updateInteractionTrace: (
		{ id, ...data }: UpdateInteractionTraceType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(interactionTrace)
			.set({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.where(eq(interactionTrace.id, id)),
	getExistingInteractionSessionTrace: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.interactionSessionTrace.findMany({
			where: eq(interactionSessionTrace.domiaId, domiaId),
			orderBy: desc(interactionSessionTrace.lastUsedAt),
			limit: 1,
		}),
	insertInteractionSessionTrace: (
		data: InsertInteractionSessionTraceType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(interactionSessionTrace).values(data),
	updateInteractionSessionTrace: (
		{ id, ...data }: UpdateInteractionSessionTraceType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(interactionSessionTrace)
			.set({
				...data,
				lastUsedAt: DEFAULT_TIMESTAMP,
				updatedAt: DEFAULT_TIMESTAMP,
			})
			.where(eq(interactionSessionTrace.id, id)),
}

export default dbAdapter

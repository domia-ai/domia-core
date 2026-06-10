import { eq, desc, and, gte, asc } from "drizzle-orm"

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
	getInteractionById: (id: string, client: DBClientOrTxType = dbClient) =>
		client.query.interactionTrace.findFirst({
			where: eq(interactionTrace.id, id),
		}),
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
	getLastInteractionAt: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.interactionTrace.findFirst({
			where: eq(interactionTrace.domiaId, domiaId),
			orderBy: desc(interactionTrace.createdAt),
			columns: { createdAt: true },
		}),
	getRecentInteractionsForDomia: (
		domiaId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.interactionTrace.findMany({
			where: eq(interactionTrace.domiaId, domiaId),
			orderBy: desc(interactionTrace.createdAt),
			limit,
		}),
	getInteractionsSince: (
		domiaId: string,
		since: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.interactionTrace.findMany({
			where: and(
				eq(interactionTrace.domiaId, domiaId),
				gte(interactionTrace.updatedAt, since),
			),
			orderBy: asc(interactionTrace.updatedAt),
			limit,
		}),
	getSessionsSince: (
		domiaId: string,
		since: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.interactionSessionTrace.findMany({
			where: and(
				eq(interactionSessionTrace.domiaId, domiaId),
				gte(interactionSessionTrace.updatedAt, since),
			),
			orderBy: asc(interactionSessionTrace.updatedAt),
			limit,
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

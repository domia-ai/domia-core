import { eq, desc, and, gte, asc } from "drizzle-orm"

import {
	dbClient,
	memoryFact,
	knowledgeEntry,
	memoryEpisode,
	userModel,
	type DBClientOrTxType,
	type InsertMemoryFactType,
	type InsertKnowledgeEntryType,
	type InsertMemoryEpisodeType,
	type InsertUserModelType,
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
	getFactsForDomia: (domiaId: string, client: DBClientOrTxType = dbClient) =>
		client.query.memoryFact.findMany({
			where: eq(memoryFact.domiaId, domiaId),
		}),
	deleteFactById: (id: string, client: DBClientOrTxType = dbClient) =>
		client.delete(memoryFact).where(eq(memoryFact.id, id)),
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
	getActiveKnowledge: (
		domiaId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.knowledgeEntry.findMany({
			where: and(
				eq(knowledgeEntry.domiaId, domiaId),
				eq(knowledgeEntry.isActive, true),
			),
			orderBy: desc(knowledgeEntry.priority),
			limit,
		}),
	getAllKnowledge: (domiaId: string, client: DBClientOrTxType = dbClient) =>
		client.query.knowledgeEntry.findMany({
			where: eq(knowledgeEntry.domiaId, domiaId),
			orderBy: desc(knowledgeEntry.priority),
		}),
	deleteKnowledge: (
		domiaId: string,
		id: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.delete(knowledgeEntry)
			.where(
				and(eq(knowledgeEntry.id, id), eq(knowledgeEntry.domiaId, domiaId)),
			),
	upsertKnowledge: (
		data: InsertKnowledgeEntryType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(knowledgeEntry)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: knowledgeEntry.id,
				set: {
					title: data.title,
					content: data.content,
					keywords: data.keywords,
					priority: data.priority,
					isActive: data.isActive,
					updatedAt: DEFAULT_TIMESTAMP,
				},
			}),
	insertEpisode: (
		data: InsertMemoryEpisodeType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(memoryEpisode).values(data),
	getLastEpisodes: (
		domiaId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.memoryEpisode.findMany({
			where: eq(memoryEpisode.domiaId, domiaId),
			orderBy: desc(memoryEpisode.createdAt),
			limit,
		}),
	getUserModel: (domiaId: string, client: DBClientOrTxType = dbClient) =>
		client.query.userModel.findFirst({
			where: eq(userModel.domiaId, domiaId),
		}),
	upsertUserModel: (
		data: InsertUserModelType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(userModel)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: userModel.domiaId,
				set: {
					summary: data.summary,
					moodTendencies: data.moodTendencies,
					interests: data.interests,
					prefs: data.prefs,
					familiarity: data.familiarity,
					updatedAt: DEFAULT_TIMESTAMP,
				},
			}),
}

export default dbAdapter

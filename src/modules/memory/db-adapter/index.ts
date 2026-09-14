import {
	eq,
	desc,
	and,
	gte,
	gt,
	lte,
	ne,
	or,
	asc,
	isNull,
	isNotNull,
	count,
	sql,
} from "drizzle-orm"

import {
	dbClient,
	memoryFact,
	factEvidence,
	knowledgeEntry,
	memoryEpisode,
	userModel,
	type DBClientOrTxType,
	type InsertMemoryFactType,
	type InsertFactEvidenceType,
	type InsertKnowledgeEntryType,
	type InsertMemoryEpisodeType,
	type InsertUserModelType,
	MS_TIMESTAMP,
	DEFAULT_TIMESTAMP,
	FACT_SOURCE_KIND_ENUM,
} from "@/db"
import type { FactValidityType } from "../types"

const CLOSED_AT = sql`coalesce(${memoryFact.validUntil}, ${MS_TIMESTAMP})`

const ACTIVE_FACT = and(
	isNull(memoryFact.supersededAt),
	or(isNull(memoryFact.validUntil), gt(memoryFact.validUntil, MS_TIMESTAMP)),
)

const EXPIRED_FACT = and(
	isNotNull(memoryFact.validUntil),
	or(
		isNotNull(memoryFact.supersededAt),
		lte(memoryFact.validUntil, MS_TIMESTAMP),
	),
)

const freshInferredFact = (inferredCutoff: string | null) =>
	inferredCutoff
		? or(
				ne(memoryFact.sourceKind, FACT_SOURCE_KIND_ENUM.INFERRED),
				gte(memoryFact.createdAt, inferredCutoff),
			)
		: undefined

const dbAdapter = {
	insertFact: (
		data: InsertMemoryFactType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(memoryFact)
			.values({ ...data, updatedAt: MS_TIMESTAMP })
			.onConflictDoNothing(),
	insertOrReactivateFact: (
		data: InsertMemoryFactType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(memoryFact)
			.values({ ...data, updatedAt: MS_TIMESTAMP })
			.onConflictDoUpdate({
				target: [
					memoryFact.domiaId,
					memoryFact.subject,
					memoryFact.relation,
					memoryFact.valueKey,
				],
				set: {
					value: data.value,
					confidence: data.confidence,
					supersededAt: null,
					validFrom: data.validFrom,
					validUntil: data.validUntil ?? null,
					updatedAt: MS_TIMESTAMP,
				},
			}),
	getActiveFactsFor: (
		domiaId: string,
		subject: string,
		relation: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.memoryFact.findMany({
			where: and(
				eq(memoryFact.domiaId, domiaId),
				eq(memoryFact.subject, subject),
				eq(memoryFact.relation, relation),
				isNull(memoryFact.supersededAt),
			),
		}),
	findFactByKey: (
		domiaId: string,
		subject: string,
		relation: string,
		valueKey: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.memoryFact.findFirst({
			where: and(
				eq(memoryFact.domiaId, domiaId),
				eq(memoryFact.subject, subject),
				eq(memoryFact.relation, relation),
				eq(memoryFact.valueKey, valueKey),
			),
		}),
	reactivateFact: (
		id: string,
		confidence: number,
		validity: FactValidityType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(memoryFact)
			.set({
				supersededAt: null,
				confidence,
				validFrom: validity.validFrom,
				validUntil: validity.validUntil,
				updatedAt: MS_TIMESTAMP,
			})
			.where(eq(memoryFact.id, id)),
	setFactConfidence: (
		id: string,
		confidence: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(memoryFact)
			.set({ confidence, updatedAt: MS_TIMESTAMP })
			.where(eq(memoryFact.id, id)),
	supersedeFact: (id: string, client: DBClientOrTxType = dbClient) =>
		client
			.update(memoryFact)
			.set({ supersededAt: MS_TIMESTAMP, updatedAt: MS_TIMESTAMP })
			.where(eq(memoryFact.id, id)),
	supersedeActiveFacts: (
		domiaId: string,
		subject: string,
		relation: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(memoryFact)
			.set({
				supersededAt: MS_TIMESTAMP,
				validUntil: CLOSED_AT,
				updatedAt: MS_TIMESTAMP,
			})
			.where(
				and(
					eq(memoryFact.domiaId, domiaId),
					eq(memoryFact.subject, subject),
					eq(memoryFact.relation, relation),
					isNull(memoryFact.supersededAt),
				),
			),
	addFactEvidence: (
		data: InsertFactEvidenceType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(factEvidence).values(data).onConflictDoNothing(),
	countFactEvidence: async (
		factId: string,
		client: DBClientOrTxType = dbClient,
	): Promise<number> => {
		const rows = await client
			.select({ n: count() })
			.from(factEvidence)
			.where(eq(factEvidence.factId, factId))
		return rows[0]?.n ?? 0
	},
	getRecentFacts: (
		domiaId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.memoryFact.findMany({
			where: and(
				eq(memoryFact.domiaId, domiaId),
				isNull(memoryFact.supersededAt),
			),
			orderBy: desc(memoryFact.createdAt),
			limit,
		}),
	getRecallFacts: async (
		domiaId: string,
		activeLimit: number,
		expiredLimit: number,
		inferredCutoff: string | null,
		client: DBClientOrTxType = dbClient,
	) => {
		const recallRows = (temporal: typeof ACTIVE_FACT, limit: number) =>
			client.query.memoryFact.findMany({
				where: and(
					eq(memoryFact.domiaId, domiaId),
					temporal,
					freshInferredFact(inferredCutoff),
				),
				orderBy: desc(memoryFact.createdAt),
				limit,
			})
		const [active, expired] = await Promise.all([
			recallRows(ACTIVE_FACT, activeLimit),
			expiredLimit > 0 ? recallRows(EXPIRED_FACT, expiredLimit) : [],
		])
		return [...active, ...expired]
	},
	getFactsForDomia: (domiaId: string, client: DBClientOrTxType = dbClient) =>
		client.query.memoryFact.findMany({
			where: eq(memoryFact.domiaId, domiaId),
		}),
	deleteFactById: (id: string, client: DBClientOrTxType = dbClient) =>
		client.delete(memoryFact).where(eq(memoryFact.id, id)),
	getFactsSince: (
		domiaId: string,
		since: string,
		sinceId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.memoryFact.findMany({
			where: and(
				eq(memoryFact.domiaId, domiaId),
				sinceId
					? or(
							gt(memoryFact.updatedAt, since),
							and(eq(memoryFact.updatedAt, since), gt(memoryFact.id, sinceId)),
						)
					: gte(memoryFact.updatedAt, since),
			),
			orderBy: [asc(memoryFact.updatedAt), asc(memoryFact.id)],
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

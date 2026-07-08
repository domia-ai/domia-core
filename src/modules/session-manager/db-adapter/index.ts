import { eq, desc, and, gte, gt, or, asc } from "drizzle-orm"

import {
	dbClient,
	interactionTrace,
	interactionSessionTrace,
	announcement,
	turnEvent,
	moduleSettings,
	type DBClientOrTxType,
	type InsertInteractionTraceType,
	type InsertInteractionSessionTraceType,
	type UpdateInteractionTraceType,
	type UpdateInteractionSessionTraceType,
	type InsertAnnouncementType,
	type InsertTurnEventType,
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
	insertTurnEvents: (
		rows: InsertTurnEventType[],
		client: DBClientOrTxType = dbClient,
	) => client.insert(turnEvent).values(rows),
	getTurnEventsSince: (
		domiaId: string,
		since: string,
		sinceId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.turnEvent.findMany({
			where: and(
				eq(turnEvent.domiaId, domiaId),
				or(
					gt(turnEvent.createdAt, since),
					and(eq(turnEvent.createdAt, since), gt(turnEvent.id, sinceId)),
				),
			),
			orderBy: [asc(turnEvent.createdAt), asc(turnEvent.id)],
			limit,
		}),
	getTurnEventsPersist: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.moduleSettings.findFirst({
			columns: { turnEventsPersist: true },
			where: and(
				eq(moduleSettings.domiaId, domiaId),
				eq(moduleSettings.isActive, true),
			),
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
			orderBy: desc(interactionTrace.updatedAt),
			columns: { updatedAt: true },
		}),
	getLastTurnEventAt: (domiaId: string, client: DBClientOrTxType = dbClient) =>
		client.query.turnEvent.findFirst({
			where: eq(turnEvent.domiaId, domiaId),
			orderBy: desc(turnEvent.createdAt),
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
	insertAnnouncement: (
		data: InsertAnnouncementType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(announcement).values(data),
	getAnnouncementById: (id: string, client: DBClientOrTxType = dbClient) =>
		client.query.announcement.findFirst({
			where: eq(announcement.id, id),
		}),
	getAnnouncementsSince: (
		domiaId: string,
		since: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.announcement.findMany({
			where: and(
				eq(announcement.domiaId, domiaId),
				gte(announcement.updatedAt, since),
			),
			orderBy: asc(announcement.updatedAt),
			limit,
		}),
	getLastAnnouncementAt: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.announcement.findFirst({
			where: eq(announcement.domiaId, domiaId),
			orderBy: desc(announcement.updatedAt),
			columns: { updatedAt: true },
		}),
}

export default dbAdapter

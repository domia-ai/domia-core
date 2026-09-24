import { and, asc, desc, eq, gt, gte, or } from "drizzle-orm"

import {
	dbClient,
	interactionTrace,
	voiceFeelAdjustment,
	type DBClientOrTxType,
	type InsertVoiceFeelAdjustmentType,
} from "@/db"

const dbAdapter = {
	listRecentTraces: (
		domiaId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.interactionTrace.findMany({
			where: eq(interactionTrace.domiaId, domiaId),
			orderBy: desc(interactionTrace.createdAt),
			limit,
			columns: {
				status: true,
				implicitFeedback: true,
				heardReply: true,
				llmResponse: true,
				eouDelayMs: true,
				endpointDebounceMs: true,
				perceivedTtfaMs: true,
				sttResult: true,
			},
		}),
	listRecent: (
		domiaId: string,
		since: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.voiceFeelAdjustment.findMany({
			where: and(
				eq(voiceFeelAdjustment.domiaId, domiaId),
				gte(voiceFeelAdjustment.createdAt, since),
			),
			orderBy: desc(voiceFeelAdjustment.createdAt),
		}),
	listLatest: (
		domiaId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.voiceFeelAdjustment.findMany({
			where: eq(voiceFeelAdjustment.domiaId, domiaId),
			orderBy: desc(voiceFeelAdjustment.createdAt),
			limit,
		}),
	listSince: (
		domiaId: string,
		since: string,
		sinceId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.voiceFeelAdjustment.findMany({
			where: and(
				eq(voiceFeelAdjustment.domiaId, domiaId),
				sinceId
					? or(
							gt(voiceFeelAdjustment.createdAt, since),
							and(
								eq(voiceFeelAdjustment.createdAt, since),
								gt(voiceFeelAdjustment.id, sinceId),
							),
						)
					: gte(voiceFeelAdjustment.createdAt, since),
			),
			orderBy: [
				asc(voiceFeelAdjustment.createdAt),
				asc(voiceFeelAdjustment.id),
			],
			limit,
		}),
	findById: (
		domiaId: string,
		id: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.voiceFeelAdjustment.findFirst({
			where: and(
				eq(voiceFeelAdjustment.domiaId, domiaId),
				eq(voiceFeelAdjustment.id, id),
			),
		}),
	insertRecommendation: (
		data: InsertVoiceFeelAdjustmentType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(voiceFeelAdjustment).values(data),
	markApplied: (
		id: string,
		appliedAt: string,
		configRevision: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(voiceFeelAdjustment)
			.set({ appliedAt, configRevision })
			.where(eq(voiceFeelAdjustment.id, id)),
	markReverted: (
		id: string,
		revertedAt: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(voiceFeelAdjustment)
			.set({ revertedAt })
			.where(eq(voiceFeelAdjustment.id, id)),
}

export default dbAdapter

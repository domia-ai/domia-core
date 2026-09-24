import {
	and,
	eq,
	or,
	lte,
	lt,
	gte,
	like,
	desc,
	asc,
	sql,
	inArray,
} from "drizzle-orm"

import {
	dbClient,
	proactiveSchedule,
	announcement,
	PROACTIVE_SCHEDULE_STATUS_ENUM,
	type InsertProactiveScheduleType,
	type SelectProactiveScheduleType,
} from "@/db"
import { generateUuid } from "@/utils"
import {
	PROACTIVE_BROADCAST_PREFIX,
	PROACTIVE_CLAIM_BATCH,
	PROACTIVE_SCHEDULE_LIST_LIMIT,
} from "../constants"
import type {
	CreateScheduleInputType,
	ProactiveScheduleStatusType,
	RetryDecisionType,
	ScheduleSummaryType,
} from "../types"

const STATUS = PROACTIVE_SCHEDULE_STATUS_ENUM

const nowIso = (): string => new Date().toISOString()

export const listSchedule = (
	domiaId: string,
	statuses?: ProactiveScheduleStatusType[],
): SelectProactiveScheduleType[] =>
	dbClient
		.select()
		.from(proactiveSchedule)
		.where(
			and(
				eq(proactiveSchedule.domiaId, domiaId),
				statuses && statuses.length > 0
					? inArray(proactiveSchedule.status, statuses)
					: undefined,
			),
		)
		.orderBy(asc(proactiveSchedule.dueAt))
		.limit(PROACTIVE_SCHEDULE_LIST_LIMIT)
		.all()

export const nextPendingDueAt = (domiaId: string): number | null => {
	const row = dbClient
		.select({ dueAt: proactiveSchedule.dueAt })
		.from(proactiveSchedule)
		.where(
			and(
				eq(proactiveSchedule.domiaId, domiaId),
				eq(proactiveSchedule.status, STATUS.PENDING),
			),
		)
		.orderBy(asc(proactiveSchedule.dueAt))
		.limit(1)
		.get()
	return row ? Date.parse(row.dueAt) : null
}

export const getScheduleById = (
	domiaId: string,
	id: string,
): SelectProactiveScheduleType | undefined =>
	dbClient
		.select()
		.from(proactiveSchedule)
		.where(
			and(eq(proactiveSchedule.domiaId, domiaId), eq(proactiveSchedule.id, id)),
		)
		.get()

export const insertSchedule = (
	domiaId: string,
	input: CreateScheduleInputType,
): SelectProactiveScheduleType => {
	const row: InsertProactiveScheduleType = {
		...input,
		id: generateUuid(),
		domiaId,
		status: STATUS.PENDING,
	}
	return dbClient.insert(proactiveSchedule).values(row).returning().get()
}

export const cancelSchedule = (
	domiaId: string,
	id: string,
): SelectProactiveScheduleType | undefined =>
	dbClient
		.update(proactiveSchedule)
		.set({
			status: STATUS.CANCELLED,
			leaseUntil: null,
			leaseOwner: null,
			updatedAt: nowIso(),
		})
		.where(
			and(
				eq(proactiveSchedule.domiaId, domiaId),
				eq(proactiveSchedule.id, id),
				inArray(proactiveSchedule.status, [STATUS.PENDING, STATUS.LEASED]),
			),
		)
		.returning()
		.get()

export const claimDue = (
	domiaId: string,
	now: Date,
	leaseMs: number,
	owner: string,
): SelectProactiveScheduleType[] => {
	const nowStr = now.toISOString()
	const leaseUntil = new Date(now.getTime() + leaseMs).toISOString()
	const due = dbClient
		.select({ id: proactiveSchedule.id })
		.from(proactiveSchedule)
		.where(
			and(
				eq(proactiveSchedule.domiaId, domiaId),
				lte(proactiveSchedule.dueAt, nowStr),
				or(
					eq(proactiveSchedule.status, STATUS.PENDING),
					and(
						eq(proactiveSchedule.status, STATUS.LEASED),
						lt(proactiveSchedule.leaseUntil, nowStr),
					),
				),
			),
		)
		.orderBy(asc(proactiveSchedule.dueAt))
		.limit(PROACTIVE_CLAIM_BATCH)
		.all()
	const claimed: SelectProactiveScheduleType[] = []
	for (const { id } of due) {
		claimed.push(
			...dbClient
				.update(proactiveSchedule)
				.set({
					status: STATUS.LEASED,
					leaseUntil,
					leaseOwner: owner,
					updatedAt: nowStr,
				})
				.where(
					and(
						eq(proactiveSchedule.id, id),
						or(
							eq(proactiveSchedule.status, STATUS.PENDING),
							and(
								eq(proactiveSchedule.status, STATUS.LEASED),
								lt(proactiveSchedule.leaseUntil, nowStr),
							),
						),
					),
				)
				.returning()
				.all(),
		)
	}
	return claimed
}

export const renewLease = (
	id: string,
	owner: string,
	leaseUntil: string,
): boolean =>
	dbClient
		.update(proactiveSchedule)
		.set({ leaseUntil, updatedAt: nowIso() })
		.where(
			and(
				eq(proactiveSchedule.id, id),
				eq(proactiveSchedule.status, STATUS.LEASED),
				eq(proactiveSchedule.leaseOwner, owner),
			),
		)
		.run().changes > 0

export const markFired = (id: string, owner: string, firedAt: Date): boolean =>
	dbClient
		.update(proactiveSchedule)
		.set({
			lastFiredAt: firedAt.toISOString(),
			firedCount: sql`${proactiveSchedule.firedCount} + 1`,
			updatedAt: firedAt.toISOString(),
		})
		.where(
			and(
				eq(proactiveSchedule.id, id),
				eq(proactiveSchedule.status, STATUS.LEASED),
				eq(proactiveSchedule.leaseOwner, owner),
			),
		)
		.run().changes > 0

export const completeSchedule = (
	id: string,
	owner: string,
	completedAt: Date,
	next: string | null,
	lastError: string | null = null,
): boolean =>
	dbClient
		.update(proactiveSchedule)
		.set({
			status: next ? STATUS.PENDING : STATUS.DONE,
			dueAt: next ?? undefined,
			leaseUntil: null,
			leaseOwner: null,
			attempts: 0,
			lastError,
			updatedAt: completedAt.toISOString(),
		})
		.where(
			and(
				eq(proactiveSchedule.id, id),
				eq(proactiveSchedule.status, STATUS.LEASED),
				eq(proactiveSchedule.leaseOwner, owner),
			),
		)
		.run().changes > 0

export const deferSchedule = (
	id: string,
	owner: string,
	dueAt: string,
	note: string,
): boolean =>
	dbClient
		.update(proactiveSchedule)
		.set({
			status: STATUS.PENDING,
			dueAt,
			leaseUntil: null,
			leaseOwner: null,
			lastError: note,
			updatedAt: nowIso(),
		})
		.where(
			and(
				eq(proactiveSchedule.id, id),
				eq(proactiveSchedule.status, STATUS.LEASED),
				eq(proactiveSchedule.leaseOwner, owner),
			),
		)
		.run().changes > 0

export const releaseSchedule = (
	id: string,
	owner: string,
	decision: RetryDecisionType,
	error: string,
): boolean =>
	dbClient
		.update(proactiveSchedule)
		.set({
			status: decision.status,
			dueAt: decision.status === "pending" ? decision.dueAt : undefined,
			attempts: decision.attempts,
			leaseUntil: null,
			leaseOwner: null,
			lastError: error,
			updatedAt: nowIso(),
		})
		.where(
			and(
				eq(proactiveSchedule.id, id),
				eq(proactiveSchedule.status, STATUS.LEASED),
				eq(proactiveSchedule.leaseOwner, owner),
			),
		)
		.run().changes > 0

export const scheduleSummary = (domiaId: string): ScheduleSummaryType => {
	const rows = dbClient
		.select({
			status: proactiveSchedule.status,
			count: sql<number>`count(*)`,
		})
		.from(proactiveSchedule)
		.where(eq(proactiveSchedule.domiaId, domiaId))
		.groupBy(proactiveSchedule.status)
		.all()
	const by = new Map(rows.map((r) => [r.status, r.count]))
	const next = dbClient
		.select({ dueAt: proactiveSchedule.dueAt })
		.from(proactiveSchedule)
		.where(
			and(
				eq(proactiveSchedule.domiaId, domiaId),
				inArray(proactiveSchedule.status, [STATUS.PENDING, STATUS.LEASED]),
			),
		)
		.orderBy(asc(proactiveSchedule.dueAt))
		.limit(1)
		.get()
	return {
		pending: by.get(STATUS.PENDING) ?? 0,
		leased: by.get(STATUS.LEASED) ?? 0,
		done: by.get(STATUS.DONE) ?? 0,
		failed: by.get(STATUS.FAILED) ?? 0,
		cancelled: by.get(STATUS.CANCELLED) ?? 0,
		nextDueAt: next?.dueAt ?? null,
	}
}

export const countProactiveAnnouncementsSince = (
	domiaId: string,
	since: string,
): number =>
	dbClient
		.select({ count: sql<number>`count(*)` })
		.from(announcement)
		.where(
			and(
				eq(announcement.domiaId, domiaId),
				eq(announcement.delivered, true),
				like(announcement.broadcastId, `${PROACTIVE_BROADCAST_PREFIX}%`),
				gte(announcement.createdAt, since),
			),
		)
		.get()?.count ?? 0

export const lastProactiveAnnouncementAt = (
	domiaId: string,
	broadcastId: string,
): string | null =>
	dbClient
		.select({ createdAt: announcement.createdAt })
		.from(announcement)
		.where(
			and(
				eq(announcement.domiaId, domiaId),
				eq(announcement.delivered, true),
				eq(announcement.broadcastId, broadcastId),
			),
		)
		.orderBy(desc(announcement.createdAt))
		.limit(1)
		.get()?.createdAt ?? null

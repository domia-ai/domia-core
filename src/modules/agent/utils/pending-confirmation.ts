import { eq, and } from "drizzle-orm"

import { languageSetsFor, agentLogger } from "@/utils"
import {
	dbClient,
	pendingConfirmationRow,
	DEFAULT_CONFIRMATION_TTL_MS,
	DEFAULT_CONFIRMATION_EXPIRED_GRACE_MS,
	CONFIRMATION_STATUS_ENUM,
} from "@/db"
import type {
	PendingConfirmationType,
	ConfirmationSettleStatusType,
} from "../types"

const store = new Map<string, PendingConfirmationType>()

export const confirmationScope = (
	domiaKey: string,
	satelliteId?: string | null,
): string => `${domiaKey}:${satelliteId ?? "local"}`

const domiaKeyOfScope = (scope: string): string =>
	scope.slice(0, scope.lastIndexOf(":"))

const persistPark = (scope: string, e: PendingConfirmationType): void => {
	try {
		dbClient
			.insert(pendingConfirmationRow)
			.values({
				scope,
				domiaKey: domiaKeyOfScope(scope),
				tool: e.tool,
				args: e.args,
				resolvedArgs: e.resolvedArgs ?? null,
				summary: e.summary ?? null,
				language: e.language,
				reasked: e.reasked === true,
				expiresAt: e.expiresAt,
				status: CONFIRMATION_STATUS_ENUM.PENDING,
				settledAt: null,
				settledBy: null,
			})
			.onConflictDoUpdate({
				target: pendingConfirmationRow.scope,
				set: {
					domiaKey: domiaKeyOfScope(scope),
					tool: e.tool,
					args: e.args,
					resolvedArgs: e.resolvedArgs ?? null,
					summary: e.summary ?? null,
					language: e.language,
					reasked: e.reasked === true,
					expiresAt: e.expiresAt,
					status: CONFIRMATION_STATUS_ENUM.PENDING,
					settledAt: null,
					settledBy: null,
				},
			})
			.run()
	} catch (err) {
		agentLogger.warn("pending confirmation persist failed", { scope, err })
	}
}

const persistSettle = (
	scope: string,
	status: ConfirmationSettleStatusType,
	settledBy?: string,
): void => {
	void dbClient
		.update(pendingConfirmationRow)
		.set({
			status,
			settledAt: new Date().toISOString(),
			settledBy: settledBy ?? null,
		})
		.where(
			and(
				eq(pendingConfirmationRow.scope, scope),
				eq(pendingConfirmationRow.status, CONFIRMATION_STATUS_ENUM.PENDING),
			),
		)
		.catch((err: unknown) =>
			agentLogger.warn("pending confirmation settle failed", {
				scope,
				status,
				err,
			}),
		)
}

const persistReasked = (scope: string): void => {
	void dbClient
		.update(pendingConfirmationRow)
		.set({ reasked: true })
		.where(eq(pendingConfirmationRow.scope, scope))
		.catch(() => undefined)
}

const liveEntry = (scope: string): PendingConfirmationType | null => {
	const e = store.get(scope)
	if (!e) return null
	const now = Date.now()
	if (now > e.expiresAt + DEFAULT_CONFIRMATION_EXPIRED_GRACE_MS) {
		store.delete(scope)
		persistSettle(scope, CONFIRMATION_STATUS_ENUM.EXPIRED)
		return null
	}
	if (now > e.expiresAt) return null
	return e
}

export const parkConfirmation = (
	scope: string,
	entry: Omit<PendingConfirmationType, "expiresAt">,
	ttlMs = DEFAULT_CONFIRMATION_TTL_MS,
): void => {
	const full = { ...entry, expiresAt: Date.now() + ttlMs }
	store.set(scope, full)
	persistPark(scope, full)
}

export const peekPendingConfirmation = (
	scope: string,
): PendingConfirmationType | null => liveEntry(scope)

export const peekExpiredConfirmation = (
	scope: string,
): PendingConfirmationType | null => {
	const e = store.get(scope)
	if (!e) return null
	const now = Date.now()
	if (
		now > e.expiresAt &&
		now <= e.expiresAt + DEFAULT_CONFIRMATION_EXPIRED_GRACE_MS
	)
		return e
	return null
}

export const takePendingConfirmation = (
	scope: string,
): PendingConfirmationType | null => {
	const e = liveEntry(scope)
	if (e) store.delete(scope)
	return e
}

export const claimConfirmation = (
	scope: string,
	status: ConfirmationSettleStatusType,
	settledBy?: string,
): boolean => {
	store.delete(scope)
	try {
		return (
			dbClient
				.update(pendingConfirmationRow)
				.set({
					status,
					settledAt: new Date().toISOString(),
					settledBy: settledBy ?? null,
				})
				.where(
					and(
						eq(pendingConfirmationRow.scope, scope),
						eq(pendingConfirmationRow.status, CONFIRMATION_STATUS_ENUM.PENDING),
					),
				)
				.run().changes > 0
		)
	} catch (err) {
		agentLogger.warn("pending confirmation claim failed", {
			scope,
			status,
			err,
		})
		return false
	}
}

export const settleConfirmation = (
	scope: string,
	status: ConfirmationSettleStatusType,
	settledBy?: string,
): void => {
	store.delete(scope)
	persistSettle(scope, status, settledBy)
}

export const markConfirmationReasked = (scope: string): void => {
	const e = liveEntry(scope)
	if (!e) return
	e.reasked = true
	persistReasked(scope)
}

export const clearPendingConfirmation = (scope: string): void => {
	if (store.delete(scope))
		persistSettle(scope, CONFIRMATION_STATUS_ENUM.SUPERSEDED)
}

export const clearConfirmationsForDomia = (domiaKey: string): void => {
	for (const key of store.keys())
		if (key.startsWith(`${domiaKey}:`)) {
			store.delete(key)
			persistSettle(key, CONFIRMATION_STATUS_ENUM.SUPERSEDED)
		}
}

export const rehydrateConfirmations = async (): Promise<number> => {
	const rows = await dbClient
		.select()
		.from(pendingConfirmationRow)
		.where(eq(pendingConfirmationRow.status, CONFIRMATION_STATUS_ENUM.PENDING))
	const now = Date.now()
	let restored = 0
	for (const row of rows) {
		if (now > row.expiresAt + DEFAULT_CONFIRMATION_EXPIRED_GRACE_MS) {
			persistSettle(row.scope, CONFIRMATION_STATUS_ENUM.EXPIRED)
			continue
		}
		if (store.has(row.scope)) continue
		store.set(row.scope, {
			tool: row.tool,
			args: row.args,
			resolvedArgs: row.resolvedArgs ?? undefined,
			summary: row.summary ?? undefined,
			language: row.language,
			reasked: row.reasked,
			expiresAt: row.expiresAt,
		})
		restored++
	}
	if (restored > 0)
		agentLogger.info(`🔒 rehydrated ${restored} pending confirmation(s)`)
	return restored
}

const normalizeReply = (transcript: string): string =>
	transcript
		.trim()
		.toLowerCase()
		.replace(/[.,!¡¿?]/g, "")

const matchesShortReply = (
	transcript: string,
	vocabulary: Set<string>,
): boolean => {
	const normalized = normalizeReply(transcript)
	if (!normalized) return false
	if (vocabulary.has(normalized)) return true
	const words = normalized.split(/\s+/)
	return words.length <= 4 && words.some((w) => vocabulary.has(w))
}

export const isAffirmative = (
	transcript: string,
	language: string | null,
): boolean =>
	matchesShortReply(transcript, languageSetsFor(language).affirmations)

export const isNegative = (
	transcript: string,
	language: string | null,
): boolean => matchesShortReply(transcript, languageSetsFor(language).negations)

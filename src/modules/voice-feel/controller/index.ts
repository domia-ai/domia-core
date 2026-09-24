import type { SelectVoiceFeelAdjustmentType } from "@/db"
import { generateUuid, parseDbTimestamp, sqliteTimestamp } from "@/utils"

import { VOICE_FEEL_DAY_MS, VOICE_FEEL_HISTORY_LIMIT } from "../constants"
import dbAdapter from "../db-adapter"
import type {
	VoiceFeelAdjustmentViewType,
	VoiceFeelCooldownType,
	VoiceFeelLedgerEntryType,
	VoiceFeelRecommendationType,
	VoiceFeelSettingsType,
	VoiceFeelSnapshotType,
	VoiceFeelTraceRowType,
} from "../types"
import { computeVoiceFeelFeatures } from "../utils"

export const listVoiceFeelTraces = async (
	domiaId: string,
	limit: number,
): Promise<VoiceFeelTraceRowType[]> =>
	limit > 0 ? await dbAdapter.listRecentTraces(domiaId, limit) : []

export const listVoiceFeelLedger = async (
	domiaId: string,
	windowMs: number,
): Promise<VoiceFeelLedgerEntryType[]> => {
	const rows = await dbAdapter.listRecent(
		domiaId,
		sqliteTimestamp(Date.now() - windowMs),
	)
	return rows
		.filter((row) => row.revertedAt === null)
		.map((row) => ({
			ruleId: row.rule,
			section: row.section,
			field: row.field,
			at: parseDbTimestamp(row.createdAt),
		}))
		.filter((entry) => !Number.isNaN(entry.at))
}

export const recordVoiceFeelRecommendation = async (
	domiaId: string,
	recommendation: VoiceFeelRecommendationType,
): Promise<string> => {
	const id = generateUuid()
	await dbAdapter.insertRecommendation({
		id,
		domiaId,
		rule: recommendation.ruleId,
		section: recommendation.section,
		field: recommendation.field,
		fromValue: recommendation.from,
		toValue: recommendation.to,
		features: recommendation.features,
		sampleSize: recommendation.sampleSize,
		confidence: recommendation.confidence,
	})
	return id
}

const toAdjustmentView = (
	row: SelectVoiceFeelAdjustmentType,
): VoiceFeelAdjustmentViewType => ({
	id: row.id,
	ruleId: row.rule,
	section: row.section,
	field: row.field,
	from: row.fromValue,
	to: row.toValue,
	sampleSize: row.sampleSize,
	confidence: row.confidence,
	configRevision: row.configRevision,
	createdAt: row.createdAt,
	appliedAt: row.appliedAt,
	revertedAt: row.revertedAt,
})

const activeCooldowns = (
	ledger: readonly VoiceFeelLedgerEntryType[],
	cooldownMs: number,
	now: number,
): VoiceFeelCooldownType[] => {
	const latest = new Map<string, VoiceFeelLedgerEntryType>()
	for (const entry of ledger) {
		const key = `${entry.section}.${entry.field}`
		const seen = latest.get(key)
		if (!seen || entry.at > seen.at) latest.set(key, entry)
	}
	return [...latest.values()]
		.map((entry) => ({
			section: entry.section,
			field: entry.field,
			ruleId: entry.ruleId,
			remainingMs: entry.at + cooldownMs - now,
			until: new Date(entry.at + cooldownMs).toISOString(),
		}))
		.filter((cooldown) => cooldown.remainingMs > 0)
		.sort((a, b) => b.remainingMs - a.remainingMs)
}

export const getVoiceFeelSnapshot = async (
	domiaId: string,
	settings: VoiceFeelSettingsType,
): Promise<VoiceFeelSnapshotType> => {
	const now = Date.now()
	const [traces, ledger, adjustments] = await Promise.all([
		listVoiceFeelTraces(domiaId, settings.windowTurns),
		listVoiceFeelLedger(
			domiaId,
			Math.max(VOICE_FEEL_DAY_MS, settings.cooldownMs),
		),
		dbAdapter.listLatest(domiaId, VOICE_FEEL_HISTORY_LIMIT),
	])
	return {
		enabled: settings.enabled,
		settings,
		features: computeVoiceFeelFeatures(traces),
		budgetUsedToday: ledger.filter(
			(entry) => now - entry.at < VOICE_FEEL_DAY_MS,
		).length,
		cooldowns: activeCooldowns(ledger, settings.cooldownMs, now),
		adjustments: adjustments.map(toAdjustmentView),
	}
}

export const findVoiceFeelAdjustment = async (
	domiaId: string,
	id: string,
): Promise<VoiceFeelAdjustmentViewType | null> => {
	const row = await dbAdapter.findById(domiaId, id)
	return row ? toAdjustmentView(row) : null
}

export const markVoiceFeelApplied = async (
	id: string,
	configRevision: number,
): Promise<void> => {
	await dbAdapter.markApplied(id, sqliteTimestamp(Date.now()), configRevision)
}

export const markVoiceFeelReverted = async (id: string): Promise<void> => {
	await dbAdapter.markReverted(id, sqliteTimestamp(Date.now()))
}

export const getVoiceFeelAdjustmentsSince = (
	domiaId: string,
	since: string,
	sinceId: string,
	limit: number,
): Promise<SelectVoiceFeelAdjustmentType[]> =>
	dbAdapter.listSince(domiaId, since, sinceId, limit)

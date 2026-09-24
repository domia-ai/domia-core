import { hostname } from "os"

import { onTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import { type DomiaType, safeOwnDomia } from "@/modules/core"
import {
	speak,
	speakAndListen,
	isDomiaBusy,
	getPresence,
	resolveSpeakDelivery,
	type SpeakTargetType,
} from "@/modules/core-bus"
import { playFeedbackSoundAndWait } from "@/modules/feedback-sounds"
import { recordAnnouncement } from "@/modules/session-manager"
import {
	parkConfirmation,
	settleConfirmation,
	confirmationScope,
} from "@/modules/agent"
import {
	DEFAULT_CONFIRMATION_TTL_MS,
	PROACTIVE_VERB_ENUM,
	PROACTIVE_IMPORTANCE_ENUM,
	PROACTIVE_TEMPLATE_KEY_ENUM,
	PROACTIVE_MISSED_ERROR,
	PROACTIVE_WAKE_MAX_MS,
	type SelectModuleSettingsType,
} from "@/db"
import {
	proactivityLogger as logger,
	sleep,
	generateUuid,
	parseDbTimestamp,
	sqliteTimestamp,
	languageSetsFor,
	runWithTraceContext,
	ensureTraceId,
} from "@/utils"
import {
	PROACTIVE_IDLE_POLL_MS,
	PROACTIVE_LEASE_RENEW_MARGIN_MS,
	PROACTIVE_NUDGE_BROADCAST_ID,
} from "../constants"
import {
	claimDue,
	renewLease,
	markFired,
	completeSchedule,
	deferSchedule,
	releaseSchedule,
	listSchedule,
	nextPendingDueAt,
	getScheduleById,
	insertSchedule,
	cancelSchedule,
	scheduleSummary,
	countProactiveAnnouncementsSince,
	lastProactiveAnnouncementAt,
} from "../db-adapter"
import {
	isWithinQuietHours,
	quietHoursEndAt,
	gateInitiative,
	decideIdleNudge,
	nextDueAt,
	retryDecision,
	broadcastIdFor,
	renderScheduleText,
	idleNudgeText,
	resolveProactiveTarget,
} from "../utils"
import type {
	ProactiveEngineHandleType,
	ProactiveActivityType,
	ProactiveBudgetType,
	ProactiveGateReasonType,
	ProactivityStatusType,
	CreateScheduleInputType,
	ProactiveScheduleStatusType,
	ScheduleItemType,
	ScheduleDeliveredListenerType,
	ScheduleReconcileSettingsType,
	ScheduleReconcileVerdictType,
} from "../types"

const engines = new Map<string, ProactiveEngineHandleType>()
const activity = new Map<string, ProactiveActivityType>()
const leaseOwner = `${hostname()}:${process.pid}:${generateUuid().slice(0, 8)}`
const VOICE_SOURCES = new Set(["local", "satellite"])
const deliveredListeners = new Set<ScheduleDeliveredListenerType>()
let activityListener: (() => void) | null = null

export const onScheduleDelivered = (
	listener: ScheduleDeliveredListenerType,
): (() => void) => {
	deliveredListeners.add(listener)
	return () => {
		deliveredListeners.delete(listener)
	}
}

const LATE_TEMPLATE_KEY: Record<string, string> = {
	[PROACTIVE_TEMPLATE_KEY_ENUM.TIMER_FINISHED]:
		PROACTIVE_TEMPLATE_KEY_ENUM.TIMER_FINISHED_LATE,
	[PROACTIVE_TEMPLATE_KEY_ENUM.ALARM_RING]:
		PROACTIVE_TEMPLATE_KEY_ENUM.ALARM_RING_LATE,
}

const isTimerRow = (item: ScheduleItemType): boolean =>
	item.templateKey !== null && item.templateKey in LATE_TEMPLATE_KEY

export const reconcileClaimed = (
	item: ScheduleItemType,
	settings: ScheduleReconcileSettingsType,
	now: Date,
): ScheduleReconcileVerdictType => {
	const dueAtMs = Date.parse(item.dueAt)
	if (item.lastFiredAt && Date.parse(item.lastFiredAt) >= dueAtMs)
		return { kind: "already-fired" }
	const overdueMs = now.getTime() - dueAtMs
	if (isTimerRow(item) && overdueMs > settings.proactiveCriticalDeferMaxMs)
		return { kind: "missed" }
	return {
		kind: "deliver",
		late: isTimerRow(item) && overdueMs > settings.proactiveDeferMaxMs,
	}
}

const resolveDeliveryTarget = (
	domia: DomiaType,
	item: ScheduleItemType,
): SpeakTargetType | undefined => {
	const presence = getPresence(domia.domiaKey)
	const last = activity.get(domia.domiaKey) ?? null
	const preferred = resolveProactiveTarget(
		presence,
		item.targetKind,
		item.targetSatelliteId,
		last,
	)
	if (preferred?.kind !== "satellite") return preferred
	const connected = presence?.satellites.some(
		(s) => s.satelliteId === preferred.satelliteId && s.connected,
	)
	if (connected) return preferred
	logger.info(
		`🔔 scheduled item "${item.name}" target satellite offline — falling back`,
		{ scheduleId: item.id, satelliteId: preferred.satelliteId },
	)
	return resolveProactiveTarget(presence, "auto", null, last)
}

const ensureActivityListener = (): void => {
	if (activityListener) return
	activityListener = onTurnEvent(
		{ types: [DOMIA_TURN_EVENT_ENUM.TURN_STARTED] },
		(event) => {
			if (event.type !== DOMIA_TURN_EVENT_ENUM.TURN_STARTED) return
			if (!VOICE_SOURCES.has(event.source)) return
			activity.set(event.originDomiaKey, {
				at: event.ts,
				satelliteId: event.satelliteId ?? null,
			})
		},
	)
}

const budgetFor = (
	domiaId: string,
	settings: SelectModuleSettingsType,
	now: number,
): ProactiveBudgetType => ({
	hourUsed: countProactiveAnnouncementsSince(
		domiaId,
		sqliteTimestamp(now - 3_600_000),
	),
	hourMax: settings.proactiveMaxPerHour,
	dayUsed: countProactiveAnnouncementsSince(
		domiaId,
		sqliteTimestamp(now - 86_400_000),
	),
	dayMax: settings.proactiveMaxPerDay,
})

const waitForIdle = async (
	domiaId: string,
	deadlineMs: number,
): Promise<boolean> => {
	const deadline = Date.now() + deadlineMs
	while (isDomiaBusy(domiaId)) {
		if (Date.now() >= deadline) return false
		await sleep(PROACTIVE_IDLE_POLL_MS)
	}
	return true
}

const deliversLocally = (
	domiaKey: string,
	target: SpeakTargetType | undefined,
): boolean => {
	const { announcer, sink, allowLocal } = resolveSpeakDelivery(domiaKey, target)
	return allowLocal && !announcer && !sink
}

const chimeIfLocal = async (
	domia: DomiaType,
	settings: SelectModuleSettingsType,
	target: SpeakTargetType | undefined,
): Promise<void> => {
	if (!settings.proactiveChimeEnabled) return
	if (!deliversLocally(domia.domiaKey, target)) return
	await playFeedbackSoundAndWait(domia, "ack")
}

const persistProactiveAnnouncement = async (
	domia: DomiaType,
	broadcastId: string,
	text: string,
	target: string,
	delivered: boolean,
	personId: string | null,
	audioId?: string,
): Promise<void> => {
	try {
		await recordAnnouncement({
			id: audioId ?? generateUuid(),
			domiaId: domia.id,
			broadcastId,
			text,
			kind: "text",
			delivery: "domia-voice",
			target,
			audioPath: null,
			personId,
			delivered,
		})
	} catch (err) {
		logger.warn("proactive announcement not recorded", {
			domiaKey: domia.domiaKey,
			broadcastId,
			err,
		})
	}
}

const failAttempt = (
	item: ScheduleItemType,
	settings: SelectModuleSettingsType,
	reason: ProactiveGateReasonType,
): void => {
	const decision = retryDecision(
		item.attempts,
		settings.proactiveMaxAttempts,
		settings.proactiveRetryBackoffMs,
		new Date(),
	)
	releaseSchedule(item.id, leaseOwner, decision, reason)
	logger.warn(
		`🔔 scheduled item "${item.name}" ${reason} → ${decision.status} (attempt ${decision.attempts}/${settings.proactiveMaxAttempts})`,
		{ scheduleId: item.id },
	)
}

const deliverScheduled = async (
	domia: DomiaType,
	settings: SelectModuleSettingsType,
	item: ScheduleItemType,
	handle: ProactiveEngineHandleType,
	late: boolean,
): Promise<ProactiveGateReasonType> => {
	const now = new Date()
	const inQuietHours = isWithinQuietHours(
		now,
		settings.proactiveQuietHoursStart,
		settings.proactiveQuietHoursEnd,
	)
	const gate = gateInitiative({
		engineOn: true,
		importance: item.importance,
		inQuietHours,
		budget: () => budgetFor(domia.id, settings, now.getTime()),
	})
	if (gate !== "ok") {
		const resumeAt =
			gate === "quiet-hours"
				? quietHoursEndAt(now, settings.proactiveQuietHoursEnd)
				: null
		const dueAt = (
			resumeAt ?? new Date(now.getTime() + settings.proactiveRetryBackoffMs)
		).toISOString()
		deferSchedule(item.id, leaseOwner, dueAt, gate)
		logger.info(`🔔 scheduled item "${item.name}" deferred (${gate})`, {
			scheduleId: item.id,
			dueAt,
		})
		return gate
	}

	const deferMs =
		item.importance === PROACTIVE_IMPORTANCE_ENUM.CRITICAL
			? settings.proactiveCriticalDeferMaxMs
			: settings.proactiveDeferMaxMs
	if (deferMs + PROACTIVE_LEASE_RENEW_MARGIN_MS > settings.proactiveLeaseMs) {
		const until = new Date(
			now.getTime() + deferMs + settings.proactiveLeaseMs,
		).toISOString()
		if (!renewLease(item.id, leaseOwner, until)) return "lease-lost"
	}
	if (!(await waitForIdle(domia.id, deferMs))) {
		failAttempt(item, settings, "busy")
		return "busy"
	}

	const language = domia.characterProfile?.language ?? null
	const text = renderScheduleText(
		late && item.templateKey
			? { ...item, templateKey: LATE_TEMPLATE_KEY[item.templateKey] }
			: item,
		language,
	)
	const target = resolveDeliveryTarget(domia, item)
	const wantsConfirmation = !!item.actionTool
	const scope = confirmationScope(
		domia.domiaKey,
		target?.kind === "satellite" ? target.satelliteId : null,
	)
	let spoken = text
	if (item.actionTool) {
		parkConfirmation(
			scope,
			{
				tool: item.actionTool,
				args: item.actionArgs ?? {},
				language,
				summary: text,
			},
			domia.llmModelConfig?.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS,
		)
		spoken = `${text} ${languageSetsFor(language).phrases.confirmAction}`
	}
	if (handle.cancelled) {
		if (wantsConfirmation) settleConfirmation(scope, "superseded")
		deferSchedule(item.id, leaseOwner, item.dueAt, "cancelled")
		return "no-delivery"
	}
	await chimeIfLocal(domia, settings, target)
	const converse =
		wantsConfirmation || item.verb === PROACTIVE_VERB_ENUM.CONVERSE
	if (!markFired(item.id, leaseOwner, new Date())) {
		if (wantsConfirmation) settleConfirmation(scope, "superseded")
		return "lease-lost"
	}
	const outcome = converse
		? await speakAndListen(domia, spoken, target)
		: await speak(domia, spoken, target, { politeness: "polite" })
	await persistProactiveAnnouncement(
		domia,
		broadcastIdFor(item.id),
		spoken,
		outcome.target,
		outcome.delivered,
		item.personId,
		outcome.audioId,
	)
	if (!outcome.delivered) {
		if (wantsConfirmation) settleConfirmation(scope, "superseded")
		const reason: ProactiveGateReasonType =
			outcome.reason === "busy" ? "busy" : "no-delivery"
		failAttempt(item, settings, reason)
		return reason
	}
	const next = nextDueAt(item, now)
	if (!completeSchedule(item.id, leaseOwner, now, next))
		logger.warn(`🔔 scheduled item "${item.name}" completion not persisted`, {
			scheduleId: item.id,
			domiaKey: domia.domiaKey,
		})
	logger.info(
		`🔔 scheduled item "${item.name}" delivered → ${outcome.target}${next ? ` (next ${next})` : ""}`,
		{ scheduleId: item.id, domiaKey: domia.domiaKey, converse },
	)
	for (const listener of deliveredListeners)
		try {
			listener({
				domia,
				item,
				target: outcome.target,
				satelliteId: target?.kind === "satellite" ? target.satelliteId : null,
			})
		} catch (err) {
			logger.warn("🔔 schedule delivered listener failed", {
				scheduleId: item.id,
				err,
			})
		}
	return "ok"
}

const settleThrownDelivery = (
	domia: DomiaType,
	settings: SelectModuleSettingsType,
	item: ScheduleItemType,
	err: unknown,
): ProactiveGateReasonType => {
	const now = new Date()
	const row = getScheduleById(domia.id, item.id)
	const fired =
		row !== undefined &&
		reconcileClaimed(row, settings, now).kind === "already-fired"
	if (!fired) {
		failAttempt(item, settings, "no-delivery")
		return "no-delivery"
	}
	completeSchedule(
		item.id,
		leaseOwner,
		now,
		nextDueAt(item, now),
		err instanceof Error ? err.message : String(err),
	)
	logger.warn(
		`🔔 scheduled item "${item.name}" already announced before the failure — completed without retry`,
		{ scheduleId: item.id, domiaKey: domia.domiaKey },
	)
	return "ok"
}

const runSchedule = async (
	domia: DomiaType,
	settings: SelectModuleSettingsType,
	handle: ProactiveEngineHandleType,
): Promise<void> => {
	const claimed = claimDue(
		domia.id,
		new Date(),
		settings.proactiveLeaseMs,
		leaseOwner,
	)
	for (const item of claimed) {
		if (handle.cancelled) break
		const leaseUntil = new Date(
			Date.now() + settings.proactiveLeaseMs,
		).toISOString()
		if (!renewLease(item.id, leaseOwner, leaseUntil)) {
			handle.lastOutcome = `${item.name}: lease-lost`
			continue
		}
		const now = new Date()
		const verdict = reconcileClaimed(item, settings, now)
		if (verdict.kind === "already-fired") {
			completeSchedule(item.id, leaseOwner, now, nextDueAt(item, now))
			logger.info(
				`🔔 scheduled item "${item.name}" already announced — completed without repeating`,
				{ scheduleId: item.id, domiaKey: domia.domiaKey },
			)
			handle.lastOutcome = `${item.name}: already-fired`
			continue
		}
		if (verdict.kind === "missed") {
			completeSchedule(
				item.id,
				leaseOwner,
				now,
				nextDueAt(item, now),
				PROACTIVE_MISSED_ERROR,
			)
			logger.warn(
				`🔔 scheduled item "${item.name}" missed — overdue past the critical window`,
				{ scheduleId: item.id, domiaKey: domia.domiaKey, dueAt: item.dueAt },
			)
			handle.lastOutcome = `${item.name}: missed`
			continue
		}
		try {
			const outcome = await deliverScheduled(
				domia,
				settings,
				item,
				handle,
				verdict.late,
			)
			handle.lastOutcome = `${item.name}: ${outcome}`
		} catch (err) {
			logger.warn("🔔 proactive delivery threw", {
				scheduleId: item.id,
				domiaKey: domia.domiaKey,
				err,
			})
			const settled = settleThrownDelivery(domia, settings, item, err)
			handle.lastOutcome = `${item.name}: ${settled}`
		}
	}
}

const runIdleNudge = async (
	domia: DomiaType,
	settings: SelectModuleSettingsType,
	handle: ProactiveEngineHandleType,
): Promise<void> => {
	const now = Date.now()
	const last = activity.get(domia.domiaKey) ?? null
	const decision = decideIdleNudge({
		engineOn: true,
		enabled: settings.proactiveIdleNudgeEnabled,
		now,
		lastActivityAt: last?.at ?? null,
		nudgedForActivityAt: handle.nudgedForActivityAt,
		idleAfterMs: settings.proactiveIdleNudgeAfterMs,
		lastNudgeAt: handle.lastNudgeAt,
		minIntervalMs: settings.proactiveIdleNudgeMinIntervalMs,
		inQuietHours: isWithinQuietHours(
			new Date(now),
			settings.proactiveQuietHoursStart,
			settings.proactiveQuietHoursEnd,
		),
		budget: () => budgetFor(domia.id, settings, now),
	})
	if (!decision.fire || !last) return
	if (isDomiaBusy(domia.id)) return
	const target = resolveProactiveTarget(
		getPresence(domia.domiaKey),
		"auto",
		null,
		last,
	)
	if (handle.cancelled) return
	const text = idleNudgeText(domia.characterProfile?.language)
	await chimeIfLocal(domia, settings, target)
	const outcome = await speakAndListen(domia, text, target)
	await persistProactiveAnnouncement(
		domia,
		PROACTIVE_NUDGE_BROADCAST_ID,
		text,
		outcome.target,
		outcome.delivered,
		null,
		outcome.audioId,
	)
	if (!outcome.delivered) {
		handle.lastOutcome = `nudge: ${outcome.reason ?? "no-delivery"}`
		logger.info(`🔔 idle nudge not delivered (${outcome.reason ?? "none"})`, {
			domiaKey: domia.domiaKey,
		})
		return
	}
	handle.nudgedForActivityAt = last.at
	handle.lastNudgeAt = now
	handle.lastOutcome = `nudge: ${outcome.target}`
	logger.info(
		`🔔 idle nudge delivered → ${outcome.target} after ${Math.round((decision.idleForMs ?? 0) / 1000)}s idle`,
		{ domiaKey: domia.domiaKey, listening: outcome.listening },
	)
}

const tick = async (handle: ProactiveEngineHandleType): Promise<void> => {
	if (handle.inFlight) return
	handle.inFlight = true
	handle.lastTickAt = Date.now()
	try {
		const domia = await safeOwnDomia(handle.domiaKey, "proactivity tick")
		const settings = domia?.moduleSettings
		if (!domia || !settings) return
		const nextTickMs = Math.max(1_000, settings.proactiveTickMs)
		if (nextTickMs !== handle.tickMs) {
			clearInterval(handle.timer)
			handle.tickMs = nextTickMs
			handle.timer = setInterval(() => void tick(handle), nextTickMs)
			handle.timer.unref()
			logger.info("🔔 proactivity tick interval re-armed", {
				domiaKey: handle.domiaKey,
				tickMs: nextTickMs,
			})
		}
		await runWithTraceContext(
			{ traceId: ensureTraceId(), originDomiaKey: domia.domiaKey },
			async () => {
				await runSchedule(domia, settings, handle)
				if (settings.proactivityEngine)
					await runIdleNudge(domia, settings, handle)
			},
		)
		armNextWake(handle)
	} catch (err) {
		logger.warn("proactivity tick failed", { domiaKey: handle.domiaKey, err })
	} finally {
		handle.inFlight = false
	}
}

export const startProactivity = (domia: DomiaType): boolean => {
	stopProactivity(domia.domiaKey)
	const settings = domia.moduleSettings
	if (!settings) return false
	ensureActivityListener()
	const tickMs = Math.max(1_000, settings.proactiveTickMs)
	const lastNudge = lastProactiveAnnouncementAt(
		domia.id,
		PROACTIVE_NUDGE_BROADCAST_ID,
	)
	const lastNudgeAt = lastNudge ? parseDbTimestamp(lastNudge) : NaN
	const handle: ProactiveEngineHandleType = {
		domiaKey: domia.domiaKey,
		domiaId: domia.id,
		timer: setInterval(() => void tick(handle), tickMs),
		wake: null,
		wakeAt: null,
		tickMs,
		inFlight: false,
		cancelled: false,
		nudgedForActivityAt: null,
		lastNudgeAt: Number.isNaN(lastNudgeAt) ? null : lastNudgeAt,
		lastTickAt: null,
		lastOutcome: null,
	}
	handle.timer.unref()
	engines.set(domia.domiaKey, handle)
	armNextWake(handle)
	logger.info(
		settings.proactivityEngine
			? "🔔 proactivity armed"
			: "🔔 proactivity schedule armed — initiative off",
		{
			domiaKey: domia.domiaKey,
			tickMs,
			idleNudge:
				settings.proactivityEngine && settings.proactiveIdleNudgeEnabled,
		},
	)
	return settings.proactivityEngine
}

const armNextWake = (handle: ProactiveEngineHandleType): void => {
	if (handle.cancelled) return
	const next = nextPendingDueAt(handle.domiaId)
	if (next !== null) wakeScheduleAt(handle.domiaKey, next)
}

export const wakeScheduleAt = (domiaKey: string, atMs: number): void => {
	const handle = engines.get(domiaKey)
	if (!handle) return
	if (handle.wakeAt !== null && handle.wakeAt <= atMs) return
	if (handle.wake) clearTimeout(handle.wake)
	const delay = Math.min(Math.max(0, atMs - Date.now()), PROACTIVE_WAKE_MAX_MS)
	handle.wakeAt = atMs
	handle.wake = setTimeout(() => {
		handle.wake = null
		handle.wakeAt = null
		void tick(handle)
	}, delay)
	handle.wake.unref()
}

export const stopProactivity = (domiaKey: string): void => {
	const handle = engines.get(domiaKey)
	if (!handle) return
	handle.cancelled = true
	clearInterval(handle.timer)
	if (handle.wake) clearTimeout(handle.wake)
	engines.delete(domiaKey)
	if (engines.size === 0 && activityListener) {
		activityListener()
		activityListener = null
	}
	logger.info("🔔 proactivity stopped", { domiaKey })
}

export const listScheduleItems = (
	domiaId: string,
	statuses?: ProactiveScheduleStatusType[],
): ScheduleItemType[] => listSchedule(domiaId, statuses)

export const getScheduleItem = (
	domiaId: string,
	id: string,
): ScheduleItemType | null => getScheduleById(domiaId, id) ?? null

export const createScheduleItem = (
	domiaId: string,
	input: CreateScheduleInputType,
): ScheduleItemType => insertSchedule(domiaId, input)

export const cancelScheduleItem = (
	domiaId: string,
	id: string,
): ScheduleItemType | null => cancelSchedule(domiaId, id) ?? null

export const getProactivityStatus = (
	domia: DomiaType,
): ProactivityStatusType => {
	const settings = domia.moduleSettings
	const now = Date.now()
	const handle = engines.get(domia.domiaKey) ?? null
	const last = activity.get(domia.domiaKey) ?? null
	const engineOn = settings?.proactivityEngine === true
	const quiet = {
		start: settings?.proactiveQuietHoursStart ?? null,
		end: settings?.proactiveQuietHoursEnd ?? null,
	}
	const inQuietHours = isWithinQuietHours(new Date(now), quiet.start, quiet.end)
	const budget: ProactiveBudgetType = settings
		? budgetFor(domia.id, settings, now)
		: { hourUsed: 0, hourMax: 0, dayUsed: 0, dayMax: 0 }
	const decision = decideIdleNudge({
		engineOn,
		enabled: settings?.proactiveIdleNudgeEnabled === true,
		now,
		lastActivityAt: last?.at ?? null,
		nudgedForActivityAt: handle?.nudgedForActivityAt ?? null,
		idleAfterMs: settings?.proactiveIdleNudgeAfterMs ?? 0,
		lastNudgeAt: handle?.lastNudgeAt ?? null,
		minIntervalMs: settings?.proactiveIdleNudgeMinIntervalMs ?? 0,
		inQuietHours,
		budget: () => budget,
	})
	const iso = (at: number | null): string | null =>
		at === null ? null : new Date(at).toISOString()
	return {
		domiaKey: domia.domiaKey,
		engine: engineOn,
		running: handle !== null,
		busy: isDomiaBusy(domia.id),
		quietHours: { ...quiet, active: inQuietHours },
		budget,
		idleNudge: {
			enabled: settings?.proactiveIdleNudgeEnabled === true,
			idleAfterMs: settings?.proactiveIdleNudgeAfterMs ?? 0,
			minIntervalMs: settings?.proactiveIdleNudgeMinIntervalMs ?? 0,
			lastActivityAt: iso(last?.at ?? null),
			lastActivitySatelliteId: last?.satelliteId ?? null,
			idleForMs: decision.idleForMs,
			armed:
				last !== null && handle?.nudgedForActivityAt !== last.at && engineOn,
			lastNudgeAt: iso(handle?.lastNudgeAt ?? null),
			decision: decision.reason,
		},
		schedule: scheduleSummary(domia.id),
		lastTickAt: iso(handle?.lastTickAt ?? null),
		lastOutcome: handle?.lastOutcome ?? null,
	}
}

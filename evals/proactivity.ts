import {
	isWithinQuietHours,
	quietHoursEndAt,
	gateInitiative,
	rateLimitAllows,
	decideIdleNudge,
	nextDueAt,
	retryDecision,
	isLeaseExpired,
	renderScheduleText,
	resolveProactiveTarget,
	broadcastIdFor,
} from "@/modules/proactivity/utils"
import type {
	ProactiveBudgetType,
	IdleNudgeInputType,
} from "@/modules/proactivity/types"
import type { PresenceEntryType } from "@/modules/core-bus/types"

import { makeChecker } from "./lib/assert"
import { env } from "./lib/env"
import { meshHeaders, sleep } from "./lib/http"

const at = (h: number, m = 0): Date => {
	const d = new Date(2026, 8, 2, h, m, 0, 0)
	return d
}

const openBudget: ProactiveBudgetType = {
	hourUsed: 0,
	hourMax: 6,
	dayUsed: 0,
	dayMax: 20,
}

const satellitePresence = (
	satellites: {
		id: string
		connected: boolean
		lastTurnAt: number | null
		canFollowUp?: boolean
	}[],
): PresenceEntryType => ({
	domiaKey: "eval",
	status: "idle",
	lastActiveAt: null,
	satellites: satellites.map((s) => ({
		satelliteId: s.id,
		protocol: "esphome",
		connected: s.connected,
		connecting: false,
		connectedAt: s.connected ? 1 : null,
		lastError: null,
		lastErrorAt: null,
		reconnectCount: 0,
		micActive: false,
		sampleRate: null,
		lastTurnAt: s.lastTurnAt,
		lastPlaybackAt: null,
		availableWakeWords: [],
		activeWakeWords: [],
		numberEntities: [],
		volume: null,
		capabilities: {
			canHear: true,
			canSpeak: true,
			canAnnounce: true,
			canIntercom: false,
			canFollowUp: s.canFollowUp ?? false,
		},
		firmwareVersion: null,
		recentEvents: [],
	})),
})

const runPure = (checker: ReturnType<typeof makeChecker>): void => {
	console.log("\n[quiet hours]")
	checker.check(
		"null window → never quiet",
		!isWithinQuietHours(at(3), null, null),
	)
	checker.check(
		"same-day window 13:00-15:00 contains 14:00",
		isWithinQuietHours(at(14), "13:00", "15:00"),
	)
	checker.check(
		"same-day window excludes 15:00 (end exclusive)",
		!isWithinQuietHours(at(15), "13:00", "15:00"),
	)
	checker.check(
		"midnight-crossing 22:00-07:00 contains 23:30",
		isWithinQuietHours(at(23, 30), "22:00", "07:00"),
	)
	checker.check(
		"midnight-crossing 22:00-07:00 contains 03:00",
		isWithinQuietHours(at(3), "22:00", "07:00"),
	)
	checker.check(
		"midnight-crossing 22:00-07:00 excludes 12:00",
		!isWithinQuietHours(at(12), "22:00", "07:00"),
	)
	checker.check(
		"malformed clock → not quiet",
		!isWithinQuietHours(at(3), "25:99", "x"),
	)
	const resume = quietHoursEndAt(at(23, 30), "07:00")
	checker.check(
		"quiet-hours resume rolls to next day 07:00",
		resume !== null &&
			resume.getHours() === 7 &&
			resume.getDate() === at(23, 30).getDate() + 1,
		String(resume),
	)

	console.log("\n[gate]")
	checker.check(
		"engine off → engine-off",
		gateInitiative({
			engineOn: false,
			importance: "normal",
			inQuietHours: false,
			budget: openBudget,
		}) === "engine-off",
	)
	checker.check(
		"quiet hours block normal",
		gateInitiative({
			engineOn: true,
			importance: "normal",
			inQuietHours: true,
			budget: openBudget,
		}) === "quiet-hours",
	)
	checker.check(
		"critical pierces quiet hours",
		gateInitiative({
			engineOn: true,
			importance: "critical",
			inQuietHours: true,
			budget: { ...openBudget, hourUsed: 99 },
		}) === "ok",
	)
	checker.check(
		"hour budget exhausted → budget-hour",
		gateInitiative({
			engineOn: true,
			importance: "normal",
			inQuietHours: false,
			budget: { ...openBudget, hourUsed: 6 },
		}) === "budget-hour",
	)
	checker.check(
		"day budget exhausted → budget-day",
		gateInitiative({
			engineOn: true,
			importance: "ambient",
			inQuietHours: false,
			budget: { ...openBudget, dayUsed: 20 },
		}) === "budget-day",
	)
	checker.check(
		"zero max = unlimited",
		gateInitiative({
			engineOn: true,
			importance: "normal",
			inQuietHours: false,
			budget: { hourUsed: 50, hourMax: 0, dayUsed: 50, dayMax: 0 },
		}) === "ok",
	)

	console.log("\n[rate limit]")
	checker.check("no previous → allowed", rateLimitAllows(null, 60_000, 100_000))
	checker.check(
		"inside interval → blocked",
		!rateLimitAllows(50_000, 60_000, 100_000),
	)
	checker.check(
		"exactly at interval → allowed",
		rateLimitAllows(40_000, 60_000, 100_000),
	)

	console.log("\n[idle nudge]")
	const base: IdleNudgeInputType = {
		engineOn: true,
		enabled: true,
		now: 10_000_000,
		lastActivityAt: 10_000_000 - 1_900_000,
		nudgedForActivityAt: null,
		idleAfterMs: 1_800_000,
		lastNudgeAt: null,
		minIntervalMs: 3_600_000,
		inQuietHours: false,
		budget: openBudget,
	}
	checker.check("fires after idle window", decideIdleNudge(base).fire)
	checker.check(
		"no activity since boot → no-activity",
		decideIdleNudge({ ...base, lastActivityAt: null }).reason === "no-activity",
	)
	checker.check(
		"not idle long enough → idle-not-reached",
		decideIdleNudge({ ...base, lastActivityAt: base.now - 60_000 }).reason ===
			"idle-not-reached",
	)
	checker.check(
		"once per idle stretch → already-nudged",
		decideIdleNudge({ ...base, nudgedForActivityAt: base.lastActivityAt })
			.reason === "already-nudged",
	)
	checker.check(
		"new activity re-arms",
		decideIdleNudge({
			...base,
			nudgedForActivityAt: (base.lastActivityAt ?? 0) - 1,
			lastNudgeAt: base.now - 4_000_000,
		}).fire,
	)
	checker.check(
		"rate limit blocks",
		decideIdleNudge({ ...base, lastNudgeAt: base.now - 60_000 }).reason ===
			"rate-limit",
	)
	checker.check(
		"quiet hours block nudge (never pierces)",
		decideIdleNudge({ ...base, inQuietHours: true }).reason === "quiet-hours",
	)
	checker.check(
		"nudge flag off → nudge-off",
		decideIdleNudge({ ...base, enabled: false }).reason === "nudge-off",
	)
	checker.check(
		"engine off wins over everything",
		decideIdleNudge({ ...base, engineOn: false }).reason === "engine-off",
	)
	checker.check(
		"budget blocks nudge",
		decideIdleNudge({ ...base, budget: { ...openBudget, hourUsed: 6 } })
			.reason === "budget-hour",
	)

	console.log("\n[schedule recurrence + retry + lease]")
	const fired = at(8, 5)
	checker.check(
		"one-shot → no next",
		nextDueAt({ repeatEveryMs: null, repeatDailyAt: null }, fired) === null,
	)
	checker.check(
		"repeatEveryMs → fired + interval",
		nextDueAt({ repeatEveryMs: 60_000, repeatDailyAt: null }, fired) ===
			new Date(fired.getTime() + 60_000).toISOString(),
	)
	const daily = nextDueAt(
		{ repeatEveryMs: null, repeatDailyAt: "08:00" },
		fired,
	)
	checker.check(
		"repeatDailyAt in the past today → tomorrow 08:00",
		daily !== null &&
			new Date(daily).getHours() === 8 &&
			new Date(daily).getDate() === fired.getDate() + 1,
		String(daily),
	)
	const later = nextDueAt(
		{ repeatEveryMs: null, repeatDailyAt: "20:00" },
		fired,
	)
	checker.check(
		"repeatDailyAt later today → today 20:00",
		later !== null &&
			new Date(later).getHours() === 20 &&
			new Date(later).getDate() === fired.getDate(),
		String(later),
	)
	const now = new Date(2_000_000)
	const retry = retryDecision(0, 3, 30_000, now)
	checker.check(
		"first failure → pending with backoff",
		retry.status === "pending" &&
			retry.attempts === 1 &&
			retry.dueAt === new Date(2_030_000).toISOString(),
	)
	const last = retryDecision(2, 3, 30_000, now)
	checker.check(
		"third failure → failed",
		last.status === "failed" && last.attempts === 3,
	)
	checker.check("null lease → expired", isLeaseExpired(null, now))
	checker.check(
		"future lease → held",
		!isLeaseExpired(new Date(2_500_000).toISOString(), now),
	)
	checker.check(
		"past lease → expired",
		isLeaseExpired(new Date(1_500_000).toISOString(), now),
	)
	checker.check(
		"broadcast id carries proactive prefix",
		broadcastIdFor("abc") === "proactive:abc",
	)

	console.log("\n[text + language]")
	checker.check(
		"inline text wins and renders placeholders",
		renderScheduleText(
			{
				name: "Pills",
				text: "Time for {name}, {who}.",
				templateKey: null,
				templateParams: { who: "Ana" },
			},
			"en",
		) === "Time for Pills, Ana.",
	)
	checker.check(
		"templateKey → catalog (es)",
		renderScheduleText(
			{
				name: "Pills",
				text: null,
				templateKey: "proactiveTimeReached",
				templateParams: { time: "ocho" },
			},
			"es",
		) === "Son las ocho.",
	)
	checker.check(
		"no text → reminder default (es)",
		renderScheduleText(
			{ name: "Pills", text: null, templateKey: null, templateParams: null },
			"es",
		) === "Recordatorio: Pills",
	)
	checker.check(
		"unknown language falls back to en",
		renderScheduleText(
			{ name: "Pills", text: null, templateKey: null, templateParams: null },
			"xx",
		) === "Reminder: Pills",
	)

	console.log("\n[target resolution]")
	const presence = satellitePresence([
		{ id: "kitchen", connected: true, lastTurnAt: 100 },
		{ id: "bedroom", connected: true, lastTurnAt: 500 },
		{ id: "garage", connected: false, lastTurnAt: 900 },
	])
	checker.check(
		"explicit local",
		resolveProactiveTarget(presence, "local", null, null)?.kind === "local",
	)
	const explicit = resolveProactiveTarget(
		presence,
		"satellite",
		"kitchen",
		null,
	)
	checker.check(
		"explicit satellite",
		explicit?.kind === "satellite" && explicit.satelliteId === "kitchen",
	)
	const recent = resolveProactiveTarget(presence, "auto", null, {
		at: 1,
		satelliteId: "kitchen",
	})
	checker.check(
		"auto prefers the room of the last turn",
		recent?.kind === "satellite" && recent.satelliteId === "kitchen",
	)
	const byTurn = resolveProactiveTarget(presence, "auto", null, null)
	checker.check(
		"auto falls back to most recent connected satellite (skips offline)",
		byTurn?.kind === "satellite" && byTurn.satelliteId === "bedroom",
	)
	checker.check(
		"auto with no satellites → default rail",
		resolveProactiveTarget(undefined, "auto", null, null) === undefined,
	)
}

type ScheduleItemWireType = {
	id: string
	status: string
	attempts: number
	firedCount: number
	lastError: string | null
	dueAt: string
}

const runLive = async (
	checker: ReturnType<typeof makeChecker>,
): Promise<void> => {
	const base = env.EVAL_URL
	const key = env.EVAL_DOMIA_KEY
	const headers = { "content-type": "application/json", ...meshHeaders() }
	const bare = meshHeaders()
	let health: Response
	try {
		health = await fetch(`${base}/health`)
	} catch {
		console.log(`\n[live] ${base} not answering — skipped`)
		return
	}
	if (!health.ok) {
		console.log(`\n[live] ${base} unhealthy — skipped`)
		return
	}
	console.log(`\n[live] ${base} (${key})`)

	const status = await fetch(`${base}/proactivity/status?domiaKey=${key}`, {
		headers,
	})
	checker.check("GET /proactivity/status 200", status.ok, String(status.status))
	const statusBody = (await status.json()) as { engine: boolean }
	checker.check(
		"status reports engine flag as boolean",
		typeof statusBody.engine === "boolean",
	)

	const missing = await fetch(`${base}/proactivity/status`, { headers })
	checker.check("status without domiaKey → 400", missing.status === 400)

	const unknown = await fetch(
		`${base}/proactivity/status?domiaKey=eval-nope-${Date.now()}`,
		{ headers },
	)
	checker.check("status for unknown identity → 404", unknown.status === 404)

	const bad = await fetch(`${base}/proactivity/schedule?domiaKey=${key}`, {
		method: "POST",
		headers,
		body: JSON.stringify({ name: "x" }),
	})
	checker.check("POST schedule without dueAt/inMs → 400", bad.status === 400)

	const created = await fetch(`${base}/proactivity/schedule?domiaKey=${key}`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			name: `eval-${Date.now()}`,
			text: "Eval reminder",
			inMs: 3_600_000,
			importance: "ambient",
		}),
	})
	checker.check("POST schedule → 201", created.status === 201)
	const { item } = (await created.json()) as { item: ScheduleItemWireType }
	checker.check("created item pending", item.status === "pending", item.status)

	const listed = await fetch(
		`${base}/proactivity/schedule?domiaKey=${key}&status=pending`,
		{ headers },
	)
	const { items } = (await listed.json()) as { items: ScheduleItemWireType[] }
	checker.check(
		"GET schedule lists the new item",
		items.some((i) => i.id === item.id),
	)

	const cancelled = await fetch(
		`${base}/proactivity/schedule/${item.id}?domiaKey=${key}`,
		{ method: "DELETE", headers: bare },
	)
	checker.check("DELETE schedule → 200", cancelled.ok, String(cancelled.status))
	const again = await fetch(
		`${base}/proactivity/schedule/${item.id}?domiaKey=${key}`,
		{ method: "DELETE", headers: bare },
	)
	checker.check(
		"DELETE twice → 409",
		again.status === 409,
		String(again.status),
	)
	const ghost = await fetch(
		`${base}/proactivity/schedule/nope-${Date.now()}?domiaKey=${key}`,
		{ method: "DELETE", headers: bare },
	)
	checker.check("DELETE unknown → 404", ghost.status === 404)

	if (!statusBody.engine) {
		console.log(
			"  (engine off on this node — lease/retry live section skipped)",
		)
		return
	}
	const due = await fetch(`${base}/proactivity/schedule?domiaKey=${key}`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			name: `eval-due-${Date.now()}`,
			text: "Eval due item",
			inMs: 0,
			importance: "ambient",
			targetKind: "local",
		}),
	})
	const dueItem = ((await due.json()) as { item: ScheduleItemWireType }).item
	let settled: ScheduleItemWireType | undefined
	for (let i = 0; i < 40; i++) {
		await sleep(1_000)
		const res = await fetch(`${base}/proactivity/schedule?domiaKey=${key}`, {
			headers,
		})
		const body = (await res.json()) as { items: ScheduleItemWireType[] }
		settled = body.items.find((it) => it.id === dueItem.id)
		if (settled && settled.status !== "pending" && settled.status !== "leased")
			break
		if (settled?.status === "pending" && settled.attempts > 0) break
	}
	checker.check(
		"due item was claimed and left the pending state at least once",
		settled !== undefined &&
			(settled.status === "done" ||
				settled.status === "failed" ||
				settled.attempts > 0 ||
				settled.firedCount > 0),
		settled ? JSON.stringify(settled) : "(not found)",
	)
	checker.check(
		"lease released after processing (never stuck in leased)",
		settled?.status !== "leased",
		settled?.status,
	)
	await fetch(`${base}/proactivity/schedule/${dueItem.id}?domiaKey=${key}`, {
		method: "DELETE",
		headers: bare,
	})
}

const main = async (): Promise<void> => {
	const checker = makeChecker()
	runPure(checker)
	await runLive(checker)
	console.log(
		`\nproactivity: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	if (checker.failCount() > 0) process.exit(1)
}

void main()

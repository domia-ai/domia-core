import { parseClock } from "@/utils"

import type {
	ProactiveGateInputType,
	ProactiveGateReasonType,
	IdleNudgeInputType,
	IdleNudgeDecisionType,
	ProactiveBudgetType,
	LazyProactiveBudgetType,
} from "../types"

const resolveBudget = (budget: LazyProactiveBudgetType): ProactiveBudgetType =>
	typeof budget === "function" ? budget() : budget

export const isWithinQuietHours = (
	now: Date,
	start: string | null | undefined,
	end: string | null | undefined,
): boolean => {
	const startMin = parseClock(start)
	const endMin = parseClock(end)
	if (startMin === null || endMin === null || startMin === endMin) return false
	const nowMin = now.getHours() * 60 + now.getMinutes()
	if (startMin < endMin) return nowMin >= startMin && nowMin < endMin
	return nowMin >= startMin || nowMin < endMin
}

export const quietHoursEndAt = (
	now: Date,
	end: string | null | undefined,
): Date | null => {
	const endMin = parseClock(end)
	if (endMin === null) return null
	const candidate = new Date(now)
	candidate.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0)
	if (candidate.getTime() <= now.getTime())
		candidate.setDate(candidate.getDate() + 1)
	return candidate
}

const budgetReason = (
	budget: ProactiveBudgetType,
): ProactiveGateReasonType | null => {
	if (budget.hourMax > 0 && budget.hourUsed >= budget.hourMax)
		return "budget-hour"
	if (budget.dayMax > 0 && budget.dayUsed >= budget.dayMax) return "budget-day"
	return null
}

export const gateInitiative = (
	input: ProactiveGateInputType,
): ProactiveGateReasonType => {
	if (!input.engineOn) return "engine-off"
	if (input.importance === "critical") return "ok"
	if (input.inQuietHours) return "quiet-hours"
	return budgetReason(resolveBudget(input.budget)) ?? "ok"
}

export const rateLimitAllows = (
	lastAt: number | null,
	minIntervalMs: number,
	now: number,
): boolean => lastAt === null || now - lastAt >= minIntervalMs

export const decideIdleNudge = (
	input: IdleNudgeInputType,
): IdleNudgeDecisionType => {
	const idleForMs =
		input.lastActivityAt === null ? null : input.now - input.lastActivityAt
	const no = (reason: ProactiveGateReasonType): IdleNudgeDecisionType => ({
		fire: false,
		reason,
		idleForMs,
	})
	if (!input.engineOn) return no("engine-off")
	if (!input.enabled) return no("nudge-off")
	if (input.lastActivityAt === null || idleForMs === null)
		return no("no-activity")
	if (input.nudgedForActivityAt === input.lastActivityAt)
		return no("already-nudged")
	if (idleForMs < input.idleAfterMs) return no("idle-not-reached")
	if (input.inQuietHours) return no("quiet-hours")
	if (!rateLimitAllows(input.lastNudgeAt, input.minIntervalMs, input.now))
		return no("rate-limit")
	const budget = budgetReason(resolveBudget(input.budget))
	if (budget) return no(budget)
	return { fire: true, reason: "ok", idleForMs }
}

import { classifyChange } from "@/modules/config-apply/utils"
import { voiceFeelLogger } from "@/utils/logger"

import {
	VOICE_FEEL_CLAMP_RATIO,
	VOICE_FEEL_DAY_MS,
	VOICE_FEEL_FORBIDDEN_FIELDS,
	VOICE_FEEL_FORBIDDEN_SUFFIXES,
	VOICE_FEEL_KNOB_DIGITS,
} from "../constants"
import type {
	VoiceFeelConditionType,
	VoiceFeelConfigType,
	VoiceFeelEngineType,
	VoiceFeelFeaturesType,
	VoiceFeelLedgerEntryType,
	VoiceFeelLimitsType,
	VoiceFeelRecommendationType,
	VoiceFeelRuleType,
} from "../types"
import { readVoiceFeelKnob } from "./knob"
import { roundTo } from "./round"

const FORBIDDEN = new Set<string>(VOICE_FEEL_FORBIDDEN_FIELDS)

const isForbiddenVoiceFeelField = (field: string): boolean =>
	FORBIDDEN.has(field) ||
	VOICE_FEEL_FORBIDDEN_SUFFIXES.some((suffix) => field.endsWith(suffix))

const holds = (
	condition: VoiceFeelConditionType,
	features: VoiceFeelFeaturesType,
): boolean =>
	condition.op === "gt"
		? features[condition.feature] > condition.value
		: features[condition.feature] < condition.value

const clampTarget = (rule: VoiceFeelRuleType, from: number, base: number) => {
	const lo = Math.max(rule.min, base * (1 - VOICE_FEEL_CLAMP_RATIO))
	const hi = Math.min(rule.max, base * (1 + VOICE_FEEL_CLAMP_RATIO))
	const raw = Math.min(hi, Math.max(lo, from + rule.step))
	return roundTo(raw, VOICE_FEEL_KNOB_DIGITS)
}

const confidenceOf = (
	rule: VoiceFeelRuleType,
	features: VoiceFeelFeaturesType,
): number => {
	const margins = rule.when.map((condition) => {
		const denom = Math.abs(condition.value) || 1
		const gap = Math.abs(features[condition.feature] - condition.value)
		return Math.min(1, gap / denom)
	})
	const margin = margins.length === 0 ? 0 : Math.min(...margins)
	const sample =
		rule.minTurns > 0 ? Math.min(1, features.turns / (rule.minTurns * 2)) : 1
	return roundTo(0.5 * sample + 0.5 * margin, 2)
}

const onCooldown = (
	rule: VoiceFeelRuleType,
	ledger: readonly VoiceFeelLedgerEntryType[],
	at: number,
	cooldownMs: number,
): boolean =>
	ledger.some(
		(entry) =>
			entry.section === rule.knob.section &&
			entry.field === rule.knob.field &&
			at - entry.at < cooldownMs,
	)

export const createVoiceFeelEngine = (
	limits: VoiceFeelLimitsType,
): VoiceFeelEngineType => {
	const consider = (
		rule: VoiceFeelRuleType,
		features: VoiceFeelFeaturesType,
		current: VoiceFeelConfigType,
		ledger: readonly VoiceFeelLedgerEntryType[],
		at: number,
	): VoiceFeelRecommendationType | null => {
		const { section, field } = rule.knob
		if (!rule.enabled) return null
		if (features.turns < rule.minTurns) return null
		if (!rule.when.every((condition) => holds(condition, features))) return null
		if (isForbiddenVoiceFeelField(field)) {
			voiceFeelLogger.warn(
				`⚠️ rule ${rule.id} targets forbidden field ${section}.${field}`,
			)
			return null
		}
		const action = classifyChange(section, field)
		if (action !== "live") {
			voiceFeelLogger.warn(
				`⚠️ rule ${rule.id} targets non-live field ${section}.${field} (${action})`,
			)
			return null
		}
		if (onCooldown(rule, ledger, at, limits.cooldownMs)) return null
		const base = limits.defaults[`${section}.${field}`]
		if (typeof base !== "number") {
			voiceFeelLogger.warn(
				`⚠️ rule ${rule.id} has no default for ${section}.${field}`,
			)
			return null
		}
		const from = readVoiceFeelKnob(current, section, field) ?? base
		const to = clampTarget(rule, from, base)
		if (rule.step > 0 ? to <= from : to >= from) return null
		return {
			ruleId: rule.id,
			section,
			field,
			from,
			to,
			features,
			sampleSize: features.turns,
			confidence: confidenceOf(rule, features),
		}
	}

	const evaluate = (
		rules: readonly VoiceFeelRuleType[],
		features: VoiceFeelFeaturesType,
		current: VoiceFeelConfigType,
		ledger: readonly VoiceFeelLedgerEntryType[],
	): VoiceFeelRecommendationType | null => {
		const at = limits.now?.() ?? Date.now()
		const spent = ledger.filter(
			(entry) => at - entry.at < VOICE_FEEL_DAY_MS,
		).length
		if (spent >= limits.dailyBudget) return null
		for (const rule of rules) {
			const recommendation = consider(rule, features, current, ledger, at)
			if (recommendation) return recommendation
		}
		return null
	}

	return { evaluate }
}

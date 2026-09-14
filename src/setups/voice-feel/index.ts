import { safeOwnDomia, type DomiaType } from "@/modules/core"
import { isDomiaBusy } from "@/modules/core-bus"
import {
	VOICE_FEEL_DAY_MS,
	VOICE_FEEL_KNOB_DEFAULTS,
	computeVoiceFeelFeatures,
	createVoiceFeelEngine,
	listVoiceFeelLedger,
	listVoiceFeelTraces,
	recordVoiceFeelRecommendation,
	voiceFeelConfigOf,
} from "@/modules/voice-feel"
import { voiceFeelLogger as logger } from "@/utils"

import type { VoiceFeelHandleType } from "./types"

const MIN_TICK_MS = 1_000

const runners = new Map<string, VoiceFeelHandleType>()

const tick = async (handle: VoiceFeelHandleType): Promise<void> => {
	if (handle.inFlight) return
	handle.inFlight = true
	try {
		const domia = await safeOwnDomia(handle.domiaKey, "voice-feel tick")
		const settings = domia?.moduleSettings
		if (!domia || !settings?.voiceFeelAutotuneEnabled) return
		if (isDomiaBusy(domia.id, domia.domiaKey)) return
		const rows = await listVoiceFeelTraces(
			domia.id,
			settings.voiceFeelWindowTurns,
		)
		if (rows.length < settings.voiceFeelMinTurns) return
		const ledger = await listVoiceFeelLedger(
			domia.id,
			Math.max(VOICE_FEEL_DAY_MS, settings.voiceFeelCooldownMs),
		)
		const engine = createVoiceFeelEngine({
			defaults: VOICE_FEEL_KNOB_DEFAULTS,
			dailyBudget: settings.voiceFeelDailyBudget,
			cooldownMs: settings.voiceFeelCooldownMs,
		})
		const features = computeVoiceFeelFeatures(rows)
		const recommendation = engine.evaluate(
			settings.voiceFeelRules,
			features,
			voiceFeelConfigOf(domia),
			ledger,
		)
		if (!recommendation) return
		await recordVoiceFeelRecommendation(domia.id, recommendation)
		logger.info(
			`🎚️ recommends ${recommendation.section}.${recommendation.field} ${recommendation.from} → ${recommendation.to} (${recommendation.ruleId}, n=${recommendation.sampleSize}, conf=${recommendation.confidence})`,
			{ domiaKey: domia.domiaKey },
		)
	} catch (err) {
		logger.warn("voice-feel tick failed", { domiaKey: handle.domiaKey, err })
	} finally {
		handle.inFlight = false
	}
}

export const startVoiceFeel = (domia: DomiaType): boolean => {
	stopVoiceFeel(domia.domiaKey)
	const settings = domia.moduleSettings
	if (!settings?.voiceFeelAutotuneEnabled) return false
	const tickMs = Math.max(MIN_TICK_MS, settings.voiceFeelTickMs)
	const handle: VoiceFeelHandleType = {
		domiaKey: domia.domiaKey,
		timer: setInterval(() => void tick(handle), tickMs),
		inFlight: false,
	}
	handle.timer.unref()
	runners.set(domia.domiaKey, handle)
	logger.info("🎚️ voice-feel autotuner armed (advisory)", {
		domiaKey: domia.domiaKey,
		tickMs,
	})
	return true
}

export const stopVoiceFeel = (domiaKey: string): void => {
	const handle = runners.get(domiaKey)
	if (!handle) return
	clearInterval(handle.timer)
	runners.delete(domiaKey)
	logger.info("🎚️ voice-feel autotuner stopped", { domiaKey })
}

export const reloadVoiceFeel = (domia: DomiaType): void => {
	stopVoiceFeel(domia.domiaKey)
	startVoiceFeel(domia)
}

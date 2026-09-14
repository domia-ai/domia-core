import { ZodError } from "zod"
import type { FastifyReply } from "fastify"

import { applyConfig, type ConfigApplyResultType } from "@/modules/config-apply"
import type { DomiaType } from "@/modules/core"
import {
	findVoiceFeelAdjustment,
	getVoiceFeelSnapshot,
	markVoiceFeelApplied,
	markVoiceFeelReverted,
	readVoiceFeelKnob,
	sameVoiceFeelKnobValue,
	voiceFeelConfigOf,
	type VoiceFeelAdjustmentViewType,
	type VoiceFeelSettingsType,
	type VoiceFeelSnapshotType,
} from "@/modules/voice-feel"
import { voiceFeelLogger } from "@/utils"

import { voiceFeelIdParamsSchema } from "../schemas"
import type { VoiceFeelMutationResponseType } from "../types"
import { badRequest, conflict, notFound } from "../utils/http-errors"

const settingsOf = (domia: DomiaType): VoiceFeelSettingsType | null => {
	const settings = domia.moduleSettings
	if (!settings) return null
	return {
		enabled: settings.voiceFeelAutotuneEnabled,
		windowTurns: settings.voiceFeelWindowTurns,
		minTurns: settings.voiceFeelMinTurns,
		dailyBudget: settings.voiceFeelDailyBudget,
		cooldownMs: settings.voiceFeelCooldownMs,
	}
}

const resolveAdjustment = async (
	domia: DomiaType,
	params: unknown,
	reply: FastifyReply,
): Promise<VoiceFeelAdjustmentViewType | FastifyReply> => {
	const parsed = voiceFeelIdParamsSchema.safeParse(params)
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid adjustment id")
	const adjustment = await findVoiceFeelAdjustment(domia.id, parsed.data.id)
	if (!adjustment)
		return notFound(reply, `unknown recommendation: ${parsed.data.id}`)
	return adjustment
}

const currentKnob = (
	domia: DomiaType,
	adjustment: VoiceFeelAdjustmentViewType,
): number | null =>
	readVoiceFeelKnob(
		voiceFeelConfigOf(domia),
		adjustment.section,
		adjustment.field,
	)

const writeKnob = async (
	domia: DomiaType,
	adjustment: VoiceFeelAdjustmentViewType,
	value: number,
	reply: FastifyReply,
): Promise<ConfigApplyResultType | FastifyReply> => {
	try {
		const { apply } = await applyConfig(domia, {
			[adjustment.section]: { [adjustment.field]: value },
		})
		return apply
	} catch (err) {
		voiceFeelLogger.error("❌ voice-feel apply failed", {
			domiaKey: domia.domiaKey,
			adjustmentId: adjustment.id,
			err,
		})
		if (err instanceof ZodError)
			return badRequest(
				reply,
				err,
				`Invalid knob: ${adjustment.section}.${adjustment.field}`,
			)
		return reply.code(500).send({ error: "Voice-feel apply failed" })
	}
}

export const handleGetVoiceFeel = async (
	domia: DomiaType,
	reply: FastifyReply,
): Promise<VoiceFeelSnapshotType | FastifyReply> => {
	const settings = settingsOf(domia)
	if (!settings)
		return conflict(reply, `identity has no module settings: ${domia.domiaKey}`)
	return getVoiceFeelSnapshot(domia.id, settings)
}

export const handlePostVoiceFeelApply = async (
	domia: DomiaType,
	params: unknown,
	reply: FastifyReply,
): Promise<VoiceFeelMutationResponseType | FastifyReply> => {
	const resolved = await resolveAdjustment(domia, params, reply)
	if (!("id" in resolved)) return resolved
	if (resolved.appliedAt)
		return conflict(reply, `recommendation already applied: ${resolved.id}`)
	if (resolved.revertedAt)
		return conflict(reply, `recommendation already reverted: ${resolved.id}`)
	const current = currentKnob(domia, resolved)
	if (current === null)
		return conflict(
			reply,
			`unknown knob: ${resolved.section}.${resolved.field}`,
		)
	if (!sameVoiceFeelKnobValue(current, resolved.from))
		return conflict(
			reply,
			`${resolved.section}.${resolved.field} is ${current}, the recommendation expected ${resolved.from}`,
		)
	const applied = await writeKnob(domia, resolved, resolved.to, reply)
	if (!("desiredRevision" in applied)) return applied
	if (applied.revertedSections.includes(resolved.section))
		return conflict(
			reply,
			`the node rolled back ${resolved.section} during apply: ${resolved.id}`,
		)
	await markVoiceFeelApplied(resolved.id, applied.desiredRevision)
	voiceFeelLogger.info(
		`🎚️ applied ${resolved.section}.${resolved.field} ${resolved.from} → ${resolved.to} (${resolved.ruleId})`,
		{ domiaKey: domia.domiaKey, adjustmentId: resolved.id },
	)
	const adjustment = await findVoiceFeelAdjustment(domia.id, resolved.id)
	return { adjustment: adjustment ?? resolved, apply: applied }
}

export const handlePostVoiceFeelRevert = async (
	domia: DomiaType,
	params: unknown,
	reply: FastifyReply,
): Promise<VoiceFeelMutationResponseType | FastifyReply> => {
	const resolved = await resolveAdjustment(domia, params, reply)
	if (!("id" in resolved)) return resolved
	if (!resolved.appliedAt)
		return conflict(reply, `recommendation was never applied: ${resolved.id}`)
	if (resolved.revertedAt)
		return conflict(reply, `recommendation already reverted: ${resolved.id}`)
	const current = currentKnob(domia, resolved)
	if (current === null)
		return conflict(
			reply,
			`unknown knob: ${resolved.section}.${resolved.field}`,
		)
	if (!sameVoiceFeelKnobValue(current, resolved.to))
		return conflict(
			reply,
			`${resolved.section}.${resolved.field} is ${current}, the applied value was ${resolved.to}`,
		)
	const applied = await writeKnob(domia, resolved, resolved.from, reply)
	if (!("desiredRevision" in applied)) return applied
	if (applied.revertedSections.includes(resolved.section))
		return conflict(
			reply,
			`the node rolled back ${resolved.section} during revert: ${resolved.id}`,
		)
	await markVoiceFeelReverted(resolved.id)
	voiceFeelLogger.info(
		`🎚️ reverted ${resolved.section}.${resolved.field} ${resolved.to} → ${resolved.from} (${resolved.ruleId})`,
		{ domiaKey: domia.domiaKey, adjustmentId: resolved.id },
	)
	const adjustment = await findVoiceFeelAdjustment(domia.id, resolved.id)
	return { adjustment: adjustment ?? resolved, apply: applied }
}

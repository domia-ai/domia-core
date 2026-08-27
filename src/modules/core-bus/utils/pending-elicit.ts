import { DEFAULT_ELICIT_TTL_MS } from "@/db"
import { domiaBusLogger, getTraceContext } from "@/utils"
import type { SkillElicitResultType } from "@/modules/skill-engine"
import { confirmationScope } from "@/modules/agent"
import type { DomiaType } from "@/modules/core"

import { speak } from "./speak"
import { getInteractionRuntime } from "./interaction-runtime"
import type { PendingElicitType, SpeakTargetType } from "../types"

const registry = new Map<string, PendingElicitType>()

export const peekPendingElicit = (scope: string): PendingElicitType | null =>
	registry.get(scope) ?? null

export const takePendingElicit = (scope: string): PendingElicitType | null => {
	const entry = registry.get(scope)
	if (!entry) return null
	registry.delete(scope)
	clearTimeout(entry.timer)
	return entry
}

const elicitOriginFor = (
	domia: DomiaType,
): { scope: string; satelliteId: string | null } => {
	const interactionId = getTraceContext()?.interactionId
	const envelope = interactionId
		? getInteractionRuntime(interactionId)?.envelope
		: undefined
	return {
		scope: confirmationScope(
			domia.domiaKey,
			envelope?.satelliteId ?? envelope?.source,
		),
		satelliteId: envelope?.satelliteId ?? null,
	}
}

const REQUIRED_KEYS = (
	schema: Record<string, unknown> | undefined,
): string[] =>
	Array.isArray((schema as { required?: unknown })?.required)
		? ((schema as { required: unknown[] }).required as string[]).map(String)
		: []

const supportedElicitSchema = (
	schema: Record<string, unknown> | undefined,
): boolean => {
	if (!schema) return true
	const props = (schema as { properties?: Record<string, unknown> }).properties
	const keys = props && typeof props === "object" ? Object.keys(props) : []
	if (keys.length > 1) return false
	return REQUIRED_KEYS(schema).length <= 1
}

export const presentElicit = (
	domia: DomiaType,
	message: string,
	requestedSchema: Record<string, unknown> | undefined,
): Promise<SkillElicitResultType> =>
	new Promise((resolve) => {
		if (!supportedElicitSchema(requestedSchema)) {
			domiaBusLogger.warn(
				"elicitation declined — multi-field schemas are unsupported by voice",
				{ domiaId: domia.id },
			)
			resolve({ action: "decline" })
			return
		}
		const { scope, satelliteId } = elicitOriginFor(domia)
		const existing = takePendingElicit(scope)
		if (existing) existing.resolve({ action: "cancel" })
		const timer = setTimeout(() => {
			registry.delete(scope)
			resolve({ action: "cancel" })
		}, DEFAULT_ELICIT_TTL_MS)
		if (typeof timer.unref === "function") timer.unref()
		const entry: PendingElicitType = {
			message,
			requestedSchema,
			language: domia.characterProfile?.language ?? null,
			resolve,
			timer,
		}
		registry.set(scope, entry)
		const cancelUndelivered = (reason: string): void => {
			if (registry.get(scope) !== entry) return
			registry.delete(scope)
			clearTimeout(timer)
			domiaBusLogger.warn(`elicitation cancelled — ${reason}`, {
				domiaId: domia.id,
			})
			resolve({ action: "cancel" })
		}
		domiaBusLogger.info(`🛎️ elicitation asked: "${message.slice(0, 80)}"`, {
			domiaId: domia.id,
		})
		const speakTarget: SpeakTargetType = satelliteId
			? { kind: "satellite", satelliteId }
			: { kind: "local" }
		void speak(domia, message, speakTarget)
			.then((result) => {
				if (!result.delivered)
					cancelUndelivered("question could not be delivered")
			})
			.catch((err) => {
				domiaBusLogger.warn("elicitation speak failed", {
					domiaId: domia.id,
					err,
				})
				cancelUndelivered("speak failed")
			})
	})

export const elicitContentFor = (
	requestedSchema: Record<string, unknown> | undefined,
	transcript: string,
	affirmative: boolean,
	negative: boolean,
): Record<string, unknown> | null => {
	const props = (
		requestedSchema as
			| { properties?: Record<string, { type?: string; enum?: unknown[] }> }
			| undefined
	)?.properties
	const keys = props && typeof props === "object" ? Object.keys(props) : []
	if (keys.length === 0) return { value: transcript.trim() }
	const key = keys[0]
	const spec = props?.[key]
	const folded = transcript.trim().toLowerCase()
	if (Array.isArray(spec?.enum)) {
		const matches = spec.enum.filter((v) => {
			if (typeof v !== "string") return false
			const value = v.toLowerCase()
			if (folded === value) return true
			const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(folded)
		})
		return matches.length === 1 ? { [key]: matches[0] } : null
	}
	if (spec?.type === "boolean")
		return affirmative !== negative ? { [key]: affirmative } : null
	if (spec?.type === "number" || spec?.type === "integer") {
		const num = Number(transcript.replace(/[^\d.-]/g, ""))
		return Number.isFinite(num) ? { [key]: num } : null
	}
	const text = transcript.trim()
	return text ? { [key]: text } : null
}

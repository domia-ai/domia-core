import {
	DEFAULT_FAST_PATH_ENABLED,
	DEFAULT_FAST_PATH_MIN_COVERAGE,
	DEFAULT_FAST_PATH_MAX_UTTERANCE_CHARS,
	DEFAULT_FAST_PATH_BLOCKLIST_ENABLED,
} from "@/db"
import { languageSetsFor, skillEngineLogger } from "@/utils"
import type { DomiaType } from "@/modules/core"
import { getConnectionsFor } from "@/modules/skill-engine"

import { fold, tokensOf } from "../utils/normalize"
import { compileIndex, dynamicHashOf } from "../utils/compile"
import { matchTemplate } from "../utils/match"
import type {
	CompiledFastPathIndexType,
	FastPathMatchType,
	FastPathVerdictType,
	FastPathSlotValueType,
} from "../types"

const indexes = new Map<string, CompiledFastPathIndexType>()
const rebuilding = new Set<string>()

const indexKey = (domia: DomiaType): string =>
	`${domia.id}|${domia.characterProfile?.language ?? ""}`

export const invalidateFastPathIndex = (domiaId: string): void => {
	for (const key of [...indexes.keys()])
		if (key.startsWith(`${domiaId}|`)) indexes.delete(key)
}

const ensureIndex = (domia: DomiaType): CompiledFastPathIndexType | null => {
	const key = indexKey(domia)
	const language = domia.characterProfile?.language ?? null
	const connections = getConnectionsFor(domia.id)
	if (connections.length === 0) return null
	const cached = indexes.get(key)
	if (!cached) {
		const built = compileIndex(connections, language)
		indexes.set(key, built)
		return built
	}
	const liveHash = dynamicHashOf(connections, language)
	if (liveHash !== cached.dynamicHash && !rebuilding.has(key)) {
		rebuilding.add(key)
		setImmediate(() => {
			try {
				indexes.set(key, compileIndex(getConnectionsFor(domia.id), language))
			} catch (error) {
				skillEngineLogger.warn("fast-path index rebuild failed", { error })
			} finally {
				rebuilding.delete(key)
			}
		})
		return null
	}
	return cached
}

const hasBlockedToken = (domia: DomiaType, folded: string): boolean => {
	const enabled =
		domia.llmModelConfig?.fastPathBlocklistEnabled ??
		DEFAULT_FAST_PATH_BLOCKLIST_ENABLED
	if (!enabled) return false
	const blockers = languageSetsFor(
		domia.characterProfile?.language,
	).fastPathBlockers
	const tokens = new Set(folded.split(" "))
	return blockers.some((b) =>
		b.includes(" ") ? folded.includes(b) : tokens.has(b),
	)
}

const argsOfCapture = (
	captures: Map<string, FastPathSlotValueType | number>,
	rangeArgOf: (slotName: string) => string | null,
	argDefaults: Record<string, unknown>,
): { args: Record<string, unknown>; resolvedArgs: Record<string, unknown> } => {
	const resolved: Record<string, unknown> = { ...argDefaults }
	const surface: Record<string, unknown> = { ...argDefaults }
	for (const [slotName, captured] of captures) {
		if (typeof captured === "number") {
			const arg = rangeArgOf(slotName) ?? slotName
			resolved[arg] = captured
			surface[arg] = captured
		} else {
			Object.assign(resolved, captured.args)
			for (const argName of Object.keys(captured.args))
				surface[argName] = captured.phrase
		}
	}
	return { args: surface, resolvedArgs: resolved }
}

export const matchFastPath = (
	domia: DomiaType,
	transcript: string,
): FastPathVerdictType => {
	const started = Date.now()
	const done = (
		v:
			| { kind: "match"; match: FastPathMatchType }
			| {
					kind: "miss"
					reason: Extract<FastPathVerdictType, { kind: "miss" }>["reason"]
			  },
	): FastPathVerdictType => ({ ...v, fastPathMs: Date.now() - started })
	if (
		(domia.llmModelConfig?.fastPathEnabled ?? DEFAULT_FAST_PATH_ENABLED) !==
		true
	)
		return done({ kind: "miss", reason: "disabled" })
	const maxChars =
		domia.llmModelConfig?.fastPathMaxUtteranceChars ??
		DEFAULT_FAST_PATH_MAX_UTTERANCE_CHARS
	if (transcript.length > maxChars)
		return done({ kind: "miss", reason: "too_long" })
	const folded = fold(transcript)
	if (folded.length === 0) return done({ kind: "miss", reason: "no_match" })
	if (hasBlockedToken(domia, folded))
		return done({ kind: "miss", reason: "blocked_token" })
	const index = ensureIndex(domia)
	if (!index)
		return done({
			kind: "miss",
			reason: rebuilding.size > 0 ? "rebuilding" : "no_index",
		})
	const utteranceTokens = new Set(tokensOf(transcript))
	const minCoverage =
		domia.llmModelConfig?.fastPathMinCoverage ?? DEFAULT_FAST_PATH_MIN_COVERAGE
	const candidates: FastPathMatchType[] = []
	for (const intent of index.intents) {
		const keywordsOk = intent.requiredKeywords.every((group) =>
			group.some((k) =>
				k.includes(" ") ? folded.includes(k) : utteranceTokens.has(k),
			),
		)
		if (!keywordsOk) continue
		for (const template of intent.templates) {
			if (!template.prefilter.test(folded)) continue
			const parsed = matchTemplate(transcript, template.ast, intent.slots)
			if (!parsed?.consumed) continue
			const coverage =
				folded.length > 0 ? parsed.literalChars / folded.length : 0
			if (parsed.literalChars === 0 || coverage < minCoverage) continue
			const { args, resolvedArgs } = argsOfCapture(
				parsed.captures,
				(slotName) => {
					const slot = intent.slots.get(slotName)
					return slot?.kind === "range" ? slot.arg : null
				},
				intent.argDefaults,
			)
			candidates.push({
				tool: intent.tool,
				namespacedName: intent.namespacedName,
				providerSlug: intent.providerSlug,
				args,
				resolvedArgs,
				literalChars: parsed.literalChars,
				slotChars: parsed.slotChars,
				coverage,
				template: template.source,
			})
		}
	}
	if (candidates.length === 0) return done({ kind: "miss", reason: "no_match" })
	candidates.sort(
		(a, b) =>
			b.literalChars - a.literalChars ||
			a.slotChars - b.slotChars ||
			a.namespacedName.localeCompare(b.namespacedName),
	)
	const best = candidates[0]
	const rival = candidates.find(
		(c) =>
			c !== best &&
			c.literalChars === best.literalChars &&
			c.slotChars === best.slotChars &&
			(c.namespacedName !== best.namespacedName ||
				JSON.stringify(c.resolvedArgs) !== JSON.stringify(best.resolvedArgs)),
	)
	if (rival) return done({ kind: "miss", reason: "ambiguous" })
	return done({ kind: "match", match: best })
}

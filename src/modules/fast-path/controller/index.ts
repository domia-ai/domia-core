import {
	DEFAULT_FAST_PATH_ENABLED,
	DEFAULT_FAST_PATH_MIN_COVERAGE,
	DEFAULT_FAST_PATH_MAX_UTTERANCE_CHARS,
	DEFAULT_FAST_PATH_BLOCKLIST_ENABLED,
	DEFAULT_FAST_PATH_COMPOUND_ENABLED,
	DEFAULT_FAST_PATH_COMPOUND_MAX_TARGETS,
	FAST_PATH_SKIP_PHRASES_PER_SIDE,
	FAST_PATH_COMPOUND_MAX_LEADING_STOPWORDS,
} from "@/db"
import {
	languageSetsFor,
	skillEngineLogger,
	type ResolvedLanguageSetsType,
} from "@/utils"
import type { DomiaType } from "@/modules/core"
import {
	getConnectionsFor,
	type OriginCapabilitiesType,
} from "@/modules/skill-engine"

import {
	fold,
	tokensOf,
	stripAdditiveCues,
	stripSkipWords,
} from "../utils/normalize"
import { compileIndex, dynamicHashOf } from "../utils/compile"
import { matchTemplate } from "../utils/match"
import type {
	BareEntityMatchType,
	CompiledFastPathIndexType,
	CompiledIntentType,
	FastPathMatchType,
	FastPathVerdictType,
	FastPathUntimedVerdictType,
	FastPathCandidateVerdictType,
	FastPathCandidatesType,
	FastPathCaptureType,
	FastPathEligibilityType,
	FastPathMatchOptionsType,
	NumberSetsType,
} from "../types"

const intentEligible = (
	intent: CompiledIntentType,
	options: FastPathMatchOptionsType,
): FastPathEligibilityType => {
	if (!options.providersEnabled && !intent.builtin) return "disabled"
	if (options.blocked && !intent.allowBlockedTokens) return "blocked"
	if (options.origin && intent.available && !intent.available(options.origin))
		return "unavailable"
	return "ok"
}

const candidatesFor = (
	index: CompiledFastPathIndexType,
	text: string,
	numbers: NumberSetsType,
	minCoverage: number,
	options: FastPathMatchOptionsType,
): FastPathCandidatesType => {
	const folded = fold(text)
	const utteranceTokens = new Set(tokensOf(text))
	const candidates: FastPathMatchType[] = []
	let skippedUnavailable = 0
	for (const intent of index.intents) {
		const eligibility = intentEligible(intent, options)
		if (eligibility !== "ok" && eligibility !== "unavailable") continue
		const keywordsOk = intent.requiredKeywords.every((group) =>
			group.some((k) =>
				k.includes(" ") ? folded.includes(k) : utteranceTokens.has(k),
			),
		)
		if (!keywordsOk) continue
		for (const template of intent.templates) {
			if (!template.prefilter.test(folded)) continue
			const parsed = matchTemplate(text, template.ast, intent.slots, numbers)
			if (!parsed?.consumed) continue
			const coverage =
				folded.length > 0 ? parsed.literalChars / folded.length : 0
			if (parsed.literalChars === 0 || coverage < minCoverage) continue
			if (eligibility === "unavailable") {
				skippedUnavailable++
				break
			}
			const { args, resolvedArgs } = argsOfCapture(
				parsed.captures,
				(slotName) => {
					const slot = intent.slots.get(slotName)
					return slot && slot.kind !== "values" ? slot.arg : null
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
				priority: intent.priority,
				template: template.source,
			})
		}
	}
	return { candidates, skippedUnavailable }
}

const bestMatchFor = (
	index: CompiledFastPathIndexType,
	text: string,
	numbers: NumberSetsType,
	minCoverage: number,
	options: FastPathMatchOptionsType,
): FastPathCandidateVerdictType => {
	const { candidates, skippedUnavailable } = candidatesFor(
		index,
		text,
		numbers,
		minCoverage,
		options,
	)
	if (candidates.length === 0)
		return skippedUnavailable > 0 ? { kind: "unavailable" } : { kind: "none" }
	candidates.sort(
		(a, b) =>
			b.priority - a.priority ||
			b.literalChars - a.literalChars ||
			a.slotChars - b.slotChars ||
			a.namespacedName.localeCompare(b.namespacedName),
	)
	const best = candidates[0]
	const rival = candidates.find(
		(c) =>
			c !== best &&
			c.priority === best.priority &&
			c.literalChars === best.literalChars &&
			c.slotChars === best.slotChars &&
			(c.namespacedName !== best.namespacedName ||
				JSON.stringify(c.resolvedArgs) !== JSON.stringify(best.resolvedArgs)),
	)
	if (rival) return { kind: "ambiguous" }
	return { kind: "match", match: best }
}

const splitOnConjunctions = (
	folded: string,
	conjunctions: string[],
): string[] => {
	const joiners = new Set(conjunctions.map((c) => fold(c)))
	const segments: string[] = []
	let current: string[] = []
	for (const token of folded.split(" ")) {
		if (joiners.has(token) && current.length > 0) {
			segments.push(current.join(" "))
			current = []
			continue
		}
		if (token.length > 0) current.push(token)
	}
	if (current.length > 0) segments.push(current.join(" "))
	return segments
}

const stripLeadingStopwords = (
	segment: string,
	stopwords: Set<string>,
): string => {
	const tokens = segment.split(" ")
	let dropped = 0
	while (
		tokens.length > 1 &&
		dropped < FAST_PATH_COMPOUND_MAX_LEADING_STOPWORDS &&
		stopwords.has(tokens[0])
	) {
		tokens.shift()
		dropped++
	}
	return tokens.join(" ")
}

const literalPrefixOf = (
	segment: string,
	match: FastPathMatchType,
): string | null => {
	const values = Object.values(match.args).flatMap((v) =>
		typeof v === "string"
			? [fold(v)]
			: Array.isArray(v)
				? v.filter((x): x is string => typeof x === "string").map(fold)
				: [],
	)
	let cut = -1
	for (const value of values) {
		if (value.length === 0) continue
		const idx = segment.indexOf(value)
		if (idx > 0 && (cut < 0 || idx < cut)) cut = idx
	}
	if (cut <= 0) return null
	const prefix = segment.slice(0, cut).trim()
	return prefix.length > 0 ? prefix : null
}

const matchCompound = (
	index: CompiledFastPathIndexType,
	transcript: string,
	sets: ResolvedLanguageSetsType,
	numbers: NumberSetsType,
	minCoverage: number,
	maxTargets: number,
	options: FastPathMatchOptionsType,
): FastPathMatchType[] | null => {
	const segments = splitOnConjunctions(fold(transcript), sets.conjunctions)
	if (segments.length < 2 || segments.length > maxTargets) return null
	const first = bestMatchFor(index, segments[0], numbers, minCoverage, options)
	if (first.kind !== "match") return null
	const prefix = literalPrefixOf(segments[0], first.match)
	if (!prefix) return null
	const matches = [first.match]
	for (const segment of segments.slice(1)) {
		const attempts = [
			segment,
			`${prefix} ${stripLeadingStopwords(segment, sets.stopwords)}`,
			`${prefix} ${segment}`,
		]
		const found = attempts
			.map((attempt) =>
				bestMatchFor(index, attempt, numbers, minCoverage, options),
			)
			.find((verdict) => verdict.kind === "match")
		if (found?.kind !== "match") return null
		matches.push(found.match)
	}
	return matches
}

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
	captures: Map<string, FastPathCaptureType>,
	scalarArgOf: (slotName: string) => string | null,
	argDefaults: Record<string, unknown>,
): { args: Record<string, unknown>; resolvedArgs: Record<string, unknown> } => {
	const resolved: Record<string, unknown> = { ...argDefaults }
	const surface: Record<string, unknown> = { ...argDefaults }
	for (const [slotName, captured] of captures) {
		if (typeof captured === "number" || typeof captured === "string") {
			const arg = scalarArgOf(slotName) ?? slotName
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

const numberSetsOf = (sets: ResolvedLanguageSetsType): NumberSetsType => ({
	words: sets.numberWords,
	joiners: sets.numberJoiners,
	durationUnits: sets.durationUnits,
	durationPhrases: sets.durationPhrases,
	unitArticles: sets.unitArticles,
	clockWords: sets.clockWords,
	clockTwelveAm: sets.clockTwelveAm,
})

const providersEnabledFor = (domia: DomiaType): boolean =>
	domia.llmModelConfig?.fastPathEnabled ?? DEFAULT_FAST_PATH_ENABLED

export const matchBareEntity = (
	domia: DomiaType,
	transcript: string,
): BareEntityMatchType | null => {
	if (!providersEnabledFor(domia)) return null
	const index = ensureIndex(domia)
	if (!index) return null
	const sets = languageSetsFor(domia.characterProfile?.language)
	const folded = stripSkipWords(
		fold(transcript),
		sets.skipWords,
		FAST_PATH_SKIP_PHRASES_PER_SIDE,
	).replace(sets.articlePrefixRe, "")
	if (!folded) return null
	for (const intent of index.intents)
		for (const slot of intent.slots.values()) {
			if (slot.kind !== "values") continue
			for (const value of slot.values) {
				if (fold(value.phrase) !== folded) continue
				if (value.target)
					return {
						name: value.target,
						phrase: value.phrase,
						providerSlug: intent.providerSlug,
					}
			}
		}
	return null
}

export const matchFastPath = (
	domia: DomiaType,
	transcript: string,
	origin: OriginCapabilitiesType | null = null,
): FastPathVerdictType => {
	const started = Date.now()
	const done = (v: FastPathUntimedVerdictType): FastPathVerdictType => ({
		...v,
		fastPathMs: Date.now() - started,
	})
	const providersEnabled = providersEnabledFor(domia)
	const index = ensureIndex(domia)
	if (!index) return done({ kind: "miss", reason: "no_index" })
	if (!providersEnabled && !index.intents.some((i) => i.builtin))
		return done({ kind: "miss", reason: "disabled" })
	const sets = languageSetsFor(domia.characterProfile?.language)
	const stripped = stripSkipWords(
		fold(transcript),
		sets.skipWords,
		FAST_PATH_SKIP_PHRASES_PER_SIDE,
	)
	if (stripped.length === 0) return done({ kind: "miss", reason: "no_match" })
	const maxChars =
		domia.llmModelConfig?.fastPathMaxUtteranceChars ??
		DEFAULT_FAST_PATH_MAX_UTTERANCE_CHARS
	if (stripped.length > maxChars)
		return done({ kind: "miss", reason: "too_long" })
	const options: FastPathMatchOptionsType = {
		blocked: hasBlockedToken(domia, stripped),
		providersEnabled,
		origin,
	}
	const numbers = numberSetsOf(sets)
	const minCoverage =
		domia.llmModelConfig?.fastPathMinCoverage ?? DEFAULT_FAST_PATH_MIN_COVERAGE
	const compoundEnabled =
		domia.llmModelConfig?.fastPathCompoundEnabled ??
		DEFAULT_FAST_PATH_COMPOUND_ENABLED
	const maxTargets =
		domia.llmModelConfig?.fastPathCompoundMaxTargets ??
		DEFAULT_FAST_PATH_COMPOUND_MAX_TARGETS
	const skipped = { unavailable: 0 }
	const attempt = (text: string): FastPathUntimedVerdictType | null => {
		const single = bestMatchFor(index, text, numbers, minCoverage, options)
		if (single.kind === "match") return { kind: "match", match: single.match }
		if (single.kind === "ambiguous")
			return { kind: "miss", reason: "ambiguous" }
		if (single.kind === "unavailable") skipped.unavailable++
		if (!compoundEnabled) return null
		const matches = matchCompound(
			index,
			text,
			sets,
			numbers,
			minCoverage,
			maxTargets,
			options,
		)
		return matches ? { kind: "compound", matches } : null
	}
	const asSpoken = attempt(stripped)
	if (asSpoken) return done(asSpoken)
	const withoutCues = stripAdditiveCues(stripped, sets.additiveCues)
	if (withoutCues !== stripped) {
		const additive = attempt(withoutCues)
		if (additive) return done(additive)
	}
	if (skipped.unavailable > 0)
		return done({ kind: "miss", reason: "unavailable" })
	if (options.blocked) return done({ kind: "miss", reason: "blocked_token" })
	return done({ kind: "miss", reason: "no_match" })
}

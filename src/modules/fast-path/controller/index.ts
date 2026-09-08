import {
	DEFAULT_FAST_PATH_ENABLED,
	DEFAULT_FAST_PATH_MIN_COVERAGE,
	DEFAULT_FAST_PATH_MAX_UTTERANCE_CHARS,
	DEFAULT_FAST_PATH_BLOCKLIST_ENABLED,
	DEFAULT_FAST_PATH_COMPOUND_ENABLED,
	DEFAULT_FAST_PATH_COMPOUND_MAX_TARGETS,
} from "@/db"
import {
	languageSetsFor,
	skillEngineLogger,
	type ResolvedLanguageSetsType,
} from "@/utils"
import type { DomiaType } from "@/modules/core"
import { getConnectionsFor } from "@/modules/skill-engine"

import { fold, tokensOf } from "../utils/normalize"
import { compileIndex, dynamicHashOf } from "../utils/compile"
import { matchTemplate } from "../utils/match"
import type {
	CompiledFastPathIndexType,
	FastPathMatchType,
	FastPathVerdictType,
	FastPathCandidateVerdictType,
	FastPathSlotValueType,
	NumberSetsType,
} from "../types"

const MAX_LEADING_STOPWORDS = 2

const candidatesFor = (
	index: CompiledFastPathIndexType,
	text: string,
	numbers: NumberSetsType,
	minCoverage: number,
): FastPathMatchType[] => {
	const folded = fold(text)
	const utteranceTokens = new Set(tokensOf(text))
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
			const parsed = matchTemplate(text, template.ast, intent.slots, numbers)
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
	return candidates
}

const bestMatchFor = (
	index: CompiledFastPathIndexType,
	text: string,
	numbers: NumberSetsType,
	minCoverage: number,
): FastPathCandidateVerdictType => {
	const candidates = candidatesFor(index, text, numbers, minCoverage)
	if (candidates.length === 0) return { kind: "none" }
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
		dropped < MAX_LEADING_STOPWORDS &&
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
): FastPathMatchType[] | null => {
	const segments = splitOnConjunctions(fold(transcript), sets.conjunctions)
	if (segments.length < 2 || segments.length > maxTargets) return null
	const first = bestMatchFor(index, segments[0], numbers, minCoverage)
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
			.map((attempt) => bestMatchFor(index, attempt, numbers, minCoverage))
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

export const matchBareEntity = (
	domia: DomiaType,
	transcript: string,
): { name: string; phrase: string } | null => {
	const enabled =
		domia.llmModelConfig?.fastPathEnabled ?? DEFAULT_FAST_PATH_ENABLED
	if (!enabled) return null
	const index = ensureIndex(domia)
	if (!index) return null
	let folded = fold(transcript)
	if (!folded) return null
	folded = folded.replace(
		languageSetsFor(domia.characterProfile?.language).articlePrefixRe,
		"",
	)
	for (const intent of index.intents)
		for (const slot of intent.slots.values()) {
			if (slot.kind !== "values") continue
			for (const value of slot.values) {
				if (fold(value.phrase) !== folded) continue
				if (value.target) return { name: value.target, phrase: value.phrase }
			}
		}
	return null
}

export const matchFastPath = (
	domia: DomiaType,
	transcript: string,
): FastPathVerdictType => {
	const started = Date.now()
	const done = (
		v:
			| { kind: "match"; match: FastPathMatchType }
			| { kind: "compound"; matches: FastPathMatchType[] }
			| {
					kind: "miss"
					reason: Extract<FastPathVerdictType, { kind: "miss" }>["reason"]
			  },
	): FastPathVerdictType => ({ ...v, fastPathMs: Date.now() - started })
	if (!(domia.llmModelConfig?.fastPathEnabled ?? DEFAULT_FAST_PATH_ENABLED))
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
	const sets = languageSetsFor(domia.characterProfile?.language)
	const numbers = { words: sets.numberWords, joiners: sets.numberJoiners }
	const minCoverage =
		domia.llmModelConfig?.fastPathMinCoverage ?? DEFAULT_FAST_PATH_MIN_COVERAGE
	const single = bestMatchFor(index, transcript, numbers, minCoverage)
	if (single.kind === "match")
		return done({ kind: "match", match: single.match })
	if (single.kind === "ambiguous")
		return done({ kind: "miss", reason: "ambiguous" })
	const compoundEnabled =
		domia.llmModelConfig?.fastPathCompoundEnabled ??
		DEFAULT_FAST_PATH_COMPOUND_ENABLED
	if (compoundEnabled) {
		const maxTargets =
			domia.llmModelConfig?.fastPathCompoundMaxTargets ??
			DEFAULT_FAST_PATH_COMPOUND_MAX_TARGETS
		const matches = matchCompound(
			index,
			transcript,
			sets,
			numbers,
			minCoverage,
			maxTargets,
		)
		if (matches) return done({ kind: "compound", matches })
	}
	return done({ kind: "miss", reason: "no_match" })
}

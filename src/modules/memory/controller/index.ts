import type { DomiaType } from "@/modules/core"
import { embed } from "@/modules/embeddings"
import {
	generateUuid,
	memoryLogger,
	languageSetsFor,
	sanitizeFactLine,
	tokensOf,
	foldText,
	containsCue,
	parseDbTimestamp,
	sqliteTimestamp,
} from "@/utils"

import {
	dbClient,
	FACT_KIND_ENUM,
	FACT_SOURCE_KIND_ENUM,
	DEFAULT_MEMORY_FACT_MAX_AGE_DAYS,
	DEFAULT_MEMORY_RECALL_INCLUDE_EXPIRED,
	type FactKindEnumType,
	type SelectMemoryFactType,
} from "@/db"
import dbAdapter from "../db-adapter"
import { factSchema } from "../schemas"
import {
	MEMORY_FACT_CANDIDATE_LIMIT,
	MEMORY_FACT_EXPIRED_CANDIDATE_LIMIT,
	MEMORY_FACT_EXTRACT_MAX,
	DEFAULT_FACT_CONFIDENCE,
	MIN_RECALL_CONF_USER,
	MIN_RECALL_CONF_PREF,
	MIN_RECALL_CONF_OBS,
	KB_CANDIDATE_LIMIT,
	OBSERVATION_QUARANTINE_CONFIDENCE,
	CORROBORATION_MIN_DISTINCT_SOURCES,
	CORROBORATED_CONFIDENCE_MARGIN,
	FACT_DEDUP_DEFAULT_THRESHOLD,
	FACT_DEDUP_RELATION_THRESHOLDS,
	SINGLE_VALUED_RELATIONS,
	RELATION_ALLOWLIST_RE,
} from "../constants"
import type { FactRecallRowType, FactValidityType, RawFactType } from "../types"

const PREFERENCE_RE =
	/prefer|like|love|enjoy|favou?rite|hate|dislike|want|drinks?|eats?|plays?|listens?|watch(es)?|reads?|wears?|collects?|supports?/i
const USER_FACT_RE =
	/name|allergic|allerg|is a|works|work as|lives|live in|born|birthday|married|family|kid|child|pet|job|from/i

export const classifyFactKind = (relation: string): FactKindEnumType => {
	const r = relation.toLowerCase()
	if (PREFERENCE_RE.test(r)) return FACT_KIND_ENUM.PREFERENCE
	if (USER_FACT_RE.test(r)) return FACT_KIND_ENUM.USER_FACT
	return FACT_KIND_ENUM.OBSERVATION
}

const confFloor = (kind: FactKindEnumType): number =>
	kind === FACT_KIND_ENUM.USER_FACT
		? MIN_RECALL_CONF_USER
		: kind === FACT_KIND_ENUM.PREFERENCE
			? MIN_RECALL_CONF_PREF
			: MIN_RECALL_CONF_OBS

const FACT_TOKEN_MIN_LENGTH = 3

const factTokensOf = (s: string, stopwords: Set<string>): string[] =>
	tokensOf(s, { minLength: FACT_TOKEN_MIN_LENGTH, stopwords })

const cosineSim = (a: number[], b: number[]): number => {
	let dot = 0
	let na = 0
	let nb = 0
	const len = Math.min(a.length, b.length)
	for (let i = 0; i < len; i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb)
	return denom === 0 ? 0 : dot / denom
}

const rankFactsLexical = (
	facts: string[],
	queryText: string,
	limit: number,
	stopwords: Set<string>,
): string[] => {
	const q = new Set(factTokensOf(queryText, stopwords))
	if (q.size === 0) return facts.slice(0, limit)
	const scored = facts.map((fact, index) => {
		const ft = factTokensOf(fact, stopwords)
		let rel = 0
		for (const t of ft) if (q.has(t)) rel++
		return { fact, index, rel }
	})
	const maxRel = scored.reduce((m, s) => Math.max(m, s.rel), 0)
	if (maxRel === 0) return facts.slice(0, limit)
	return scored
		.sort((a, b) => b.rel - a.rel || a.index - b.index)
		.slice(0, limit)
		.sort((a, b) => a.index - b.index)
		.map((s) => s.fact)
}

const FACT_WHEN_NOW = "now"
const FACT_WHEN_PAST = "past"
const FACT_WHEN_FUTURE = "future"

export const resolveFactValidity = (
	when?: string,
	nowAt: number = Date.now(),
): FactValidityType => {
	const at = sqliteTimestamp(nowAt)
	const token = (when ?? "").trim().toLowerCase()
	if (token === FACT_WHEN_PAST) return { validFrom: at, validUntil: at }
	if (!token || token === FACT_WHEN_NOW || token === FACT_WHEN_FUTURE)
		return { validFrom: at, validUntil: null }
	const stated = Date.parse(token)
	return Number.isNaN(stated)
		? { validFrom: at, validUntil: null }
		: { validFrom: sqliteTimestamp(stated), validUntil: null }
}

const isFactExpired = (
	row: Pick<FactRecallRowType, "validUntil" | "supersededAt">,
	nowAt: number = Date.now(),
): boolean => {
	if (row.supersededAt) return true
	const endsAt = parseDbTimestamp(row.validUntil)
	return !Number.isNaN(endsAt) && endsAt <= nowAt
}

export const isPastTenseQuery = (
	text: string,
	language?: string | null,
): boolean => {
	const folded = foldText(text)
	return languageSetsFor(language).pastTenseCues.some((cue) =>
		containsCue(folded, cue),
	)
}

export const renderFactRecallLines = (
	rows: FactRecallRowType[],
	language?: string | null,
	nowAt: number = Date.now(),
): string[] => {
	const formerly = languageSetsFor(language).phrases.formerly
	const current: string[] = []
	const expired: string[] = []
	for (const row of rows) {
		const line = sanitizeFactLine(
			`${row.subject} ${row.relation} ${row.value}`,
		).text
		if (isFactExpired(row, nowAt)) expired.push(`${formerly} ${line}`)
		else current.push(line)
	}
	return [...current.reverse(), ...expired.reverse()]
}

const selectTemporalFacts = (
	facts: string[],
	includeExpired: boolean,
	language?: string | null,
): string[] => {
	if (includeExpired) return facts
	const formerly = languageSetsFor(language).phrases.formerly
	return facts.filter((fact) => !fact.startsWith(formerly))
}

export const staleInferredFactCutoff = (domia: DomiaType): string | null => {
	const maxAgeDays =
		domia.moduleSettings?.memoryFactMaxAgeDays ??
		DEFAULT_MEMORY_FACT_MAX_AGE_DAYS
	if (maxAgeDays === null || maxAgeDays <= 0) return null
	return sqliteTimestamp(Date.now() - maxAgeDays * 86_400_000)
}

export const rankFactsByRelevance = async (
	domia: DomiaType,
	candidates: string[],
	queryText: string,
	limit: number,
): Promise<string[]> => {
	const language = domia.characterProfile?.language
	const includeExpired =
		(domia.moduleSettings?.memoryRecallIncludeExpired ??
			DEFAULT_MEMORY_RECALL_INCLUDE_EXPIRED) ||
		isPastTenseQuery(queryText, language)
	const facts = selectTemporalFacts(candidates, includeExpired, language)
	if (facts.length === 0) return facts
	const stopwords = languageSetsFor(language).stopwords
	if (facts.length <= limit)
		return rankFactsLexical(facts, queryText, limit, stopwords)
	const vectors = await embed(domia, [queryText, ...facts])
	if (vectors?.length !== facts.length + 1)
		return rankFactsLexical(facts, queryText, limit, stopwords)
	const query = vectors[0]
	return facts
		.map((fact, index) => ({
			fact,
			index,
			rel: cosineSim(query, vectors[index + 1]),
		}))
		.sort((a, b) => b.rel - a.rel || a.index - b.index)
		.slice(0, limit)
		.sort((a, b) => a.index - b.index)
		.map((s) => s.fact)
}

export const getPreviouslyStrings = async (
	domia: DomiaType,
): Promise<string[]> => {
	try {
		const rows = await dbAdapter.getLastEpisodes(domia.id, 2)
		return rows.map((r) => r.summary).filter((s): s is string => !!s)
	} catch {
		return []
	}
}

export const getUserModelSummary = async (
	domia: DomiaType,
): Promise<string | null> => {
	try {
		const row = await dbAdapter.getUserModel(domia.id)
		if (!row) return null
		const parts: string[] = []
		if (row.summary?.trim()) parts.push(row.summary.trim())
		const interests = (row.interests ?? []).filter((s) => s.trim())
		if (interests.length) parts.push(`They're into ${interests.join(", ")}.`)
		const prefs = (row.prefs ?? []).filter((s) => s.trim())
		if (prefs.length) parts.push(`They prefer ${prefs.join(", ")}.`)
		if (row.moodTendencies?.trim())
			parts.push(`They tend to be ${row.moodTendencies.trim()}.`)
		return parts.length ? parts.join(" ") : null
	} catch {
		return null
	}
}

export const recordEpisode = async (
	domia: DomiaType,
	sessionId: string,
	data: { summary: string; moodArc?: string | null; topics?: string[] | null },
): Promise<void> => {
	await dbAdapter.insertEpisode({
		id: generateUuid(),
		domiaId: domia.id,
		sessionId,
		summary: data.summary,
		moodArc: data.moodArc ?? null,
		topics: data.topics ?? null,
	})
}

export const patchUserModel = async (
	domia: DomiaType,
	patch: {
		summary?: string | null
		moodTendencies?: string | null
		interests?: string[] | null
		prefs?: string[] | null
	},
): Promise<void> => {
	const existing = await dbAdapter.getUserModel(domia.id)
	await dbAdapter.upsertUserModel({
		id: existing?.id ?? generateUuid(),
		domiaId: domia.id,
		summary: patch.summary ?? existing?.summary ?? null,
		moodTendencies: patch.moodTendencies ?? existing?.moodTendencies ?? null,
		interests: patch.interests ?? existing?.interests ?? null,
		prefs: patch.prefs ?? existing?.prefs ?? null,
		familiarity: (existing?.familiarity ?? 0) + 1,
	})
}

export const getKnowledgeStrings = async (
	domia: DomiaType,
): Promise<string[]> => {
	try {
		const rows = await dbAdapter.getActiveKnowledge(
			domia.id,
			KB_CANDIDATE_LIMIT,
		)
		return rows.map((row) => `${row.title}: ${row.content}`)
	} catch {
		return []
	}
}

export const listKnowledgeEntries = (domia: DomiaType) =>
	dbAdapter.getAllKnowledge(domia.id)

export const upsertKnowledgeEntry = async (
	domia: DomiaType,
	input: {
		id?: string
		title: string
		content: string
		keywords?: string[] | null
		priority?: number | null
		isActive?: boolean | null
	},
): Promise<void> => {
	await dbAdapter.upsertKnowledge({
		id: input.id ?? generateUuid(),
		domiaId: domia.id,
		title: input.title.trim(),
		content: input.content.trim(),
		keywords: input.keywords ?? null,
		priority: input.priority ?? 0,
		isActive: input.isActive ?? true,
	})
}

export const deleteKnowledgeEntry = (domia: DomiaType, id: string) =>
	dbAdapter.deleteKnowledge(domia.id, id)

export const getFactsSince = (
	domiaId: string,
	since: string,
	sinceId: string,
	limit: number,
) => dbAdapter.getFactsSince(domiaId, since, sinceId, limit)

export const getLastFactAt = async (domiaId: string) => {
	const row = await dbAdapter.getLastFactAt(domiaId)
	return row?.updatedAt ?? null
}

export const isExplicitMemoryCommand = (
	text: string,
	language?: string | null,
): boolean => languageSetsFor(language).memoryCommandRe.test(text)

export const buildFactExtractionLines = (): string[] => [
	`Also extract durable facts the person EXPLICITLY stated about themselves. Format as objects {subject, relation, value, confidence, when}: "subject" is ALWAYS exactly "the user" — the person speaking — never "the user said X", never their name, and never a third party they mention (fold that person into the relation instead); "relation" is short lowercase (e.g. "is named", "is allergic to", "likes", "dislikes"); "value" is the plain detail with NO brackets or quotes (e.g. Kevin, green tea); "confidence" is 0..1; "when" is "now" (true today — the default), "past" (was true, is NOT true now: "I used to…", "I no longer…"), "future" (a plan) or a date like 2026-12-01.`,
	`Only DURABLE identity qualifies: name, tastes, relationships, possessions, allergies, home, work. NEVER capture in-the-moment actions, requests or commands. "Turn on the kitchen lights" → NOT a fact (a command). "Remind me at nine" → NOT a fact (a request). "My name is Kevin" → {subject:"the user", relation:"is named", value:"Kevin"} IS a fact.`,
	`DO capture clear first-person declarations: "my name is Kevin" → {subject:"the user", relation:"is named", value:"Kevin"}; "I love green tea" → {subject:"the user", relation:"likes", value:"green tea"}; "I can't stand coffee" → {subject:"the user", relation:"dislikes", value:"coffee"}; "I'm allergic to peanuts" → {subject:"the user", relation:"is allergic to", value:"peanuts"}; facts about THEIR people and pets too, still with subject "the user" — "my sister's name is Elena" → {subject:"the user", relation:"has a sister named", value:"Elena"}; "my dog is called Luka" → {subject:"the user", relation:"has a dog named", value:"Luka"}. Preferences, name, allergies, relationships, and plans they state ARE facts — capture them.`,
	`KEEP THE ATTRIBUTE they named — never collapse it into a bare "likes": "my favorite color is blue" → {subject:"the user", relation:"has favorite color", value:"blue"} (NOT likes | blue); "my favourite song is Clair de Lune" → {subject:"the user", relation:"has favorite song", value:"Clair de Lune"}. The "value" is only the detail, never the attribute word.`,
	`The value MUST come from the PERSON's own words in this exchange. If it appears only in YOUR reply — you told a joke about a penguin, you suggested a restaurant — it is NOT a fact: emit nothing for it.`,
	`When the person RETRACTS or REVERSES something ("I quit coffee", "I no longer like tea", "I switched from X to Y", "actually I can't stand it anymore"), emit a retraction with "op":"delete" for the OLD fact ({subject:"the user", relation:"likes", value:"coffee", op:"delete"}) — and for a switch also add the NEW fact. Default op is "add"; only set "delete" for an explicit retraction. A past-tense statement that is NOT a retraction ("I used to live in Bogotá", "I lived in Berlin for years") stays an "add" with "when":"past" — never a delete. KEEP THE POLARITY THEY USED: "used to like X" is still {relation:"likes", value:"X", when:"past"} — NEVER "dislikes". "I used to like coffee, now I only drink tea" → [{subject:"the user", relation:"drinks", value:"tea", when:"now"}, {subject:"the user", relation:"likes", value:"coffee", when:"past"}].`,
	`NEVER create a fact from: (a) a QUESTION they asked — "do you have a spa?" does NOT mean they like spas; (b) YOUR reply or suggestions — recommending an action movie does NOT mean they like action movies; (c) anything about you, the assistant, or Domia; (d) the EXAMPLES in these instructions — Kevin, green tea, coffee and peanuts are illustrations, never facts, unless THIS conversation explicitly stated them. If they only asked a question or made small talk, return [].`,
]

export const parseFacts = (input: unknown): RawFactType[] => {
	if (!Array.isArray(input)) return []
	return input
		.map((item) => factSchema.safeParse(item))
		.filter((r): r is { success: true; data: RawFactType } => r.success)
		.map((r) => r.data)
		.filter((f) => f.subject.trim() && f.relation.trim() && f.value.trim())
		.slice(0, MEMORY_FACT_EXTRACT_MAX)
}

const stripBrackets = (raw: string): string =>
	raw
		.trim()
		.replace(/^[[("'“‘]+/, "")
		.replace(/[\])"'”’]+$/, "")
		.trim()

const normalizeFactKey = (raw: string): string =>
	stripBrackets(sanitizeFactLine(raw).text)
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()

const SPEAKER_SUBJECT = "the user"
const SPEAKER_RE =
	/^(the user|the person|the speaker|they|user|the user said[a-z ]*|the person said[a-z ]*)$/

const canonicalSubject = (raw: string): string => {
	const norm = normalizeFactKey(raw)
	if (SPEAKER_RE.test(norm) || norm.startsWith("the user"))
		return SPEAKER_SUBJECT
	return norm
}

const IDENTITY_PROTECT_FLOOR = 0.85

// what the user is doing right now is conversation, not durable memory — ephemeral captures poison recall and churn the prompt prefix
const EPHEMERAL_FACT_RE =
	/\b(is (asking|saying|doing|trying|requesting|telling|wondering|testing)|asked (for|to|about)|wants? (the|to turn|to set|to play)|turn(ing|ed)? (on|off)|has recently|right now|currently|just (said|asked|did)|is aware of|talks later|will call at)\b/i

export const isEphemeralFact = (relation: string, value: string): boolean =>
	EPHEMERAL_FACT_RE.test(`${relation} ${value}`)

export const rejectFact = (
	subject: string,
	relation: string,
	value: string,
	stopwords: Set<string>,
): string | null => {
	if (subject !== SPEAKER_SUBJECT) return "subject not the user"
	if (!RELATION_ALLOWLIST_RE.test(relation)) return "relation not state-shaped"
	if (isEphemeralFact(relation, value)) return "ephemeral"
	if (factTokensOf(value, stopwords).length === 0 && value.length < 3)
		return "value not meaningful"
	return null
}

const dedupThreshold = (relation: string): number =>
	FACT_DEDUP_RELATION_THRESHOLDS[relation] ?? FACT_DEDUP_DEFAULT_THRESHOLD

const findSemanticDuplicate = async (
	domia: DomiaType,
	value: string,
	candidates: { id: string; value: string; confidence: number | null }[],
	relation: string,
): Promise<{ id: string; confidence: number | null } | null> => {
	if (!candidates.length) return null
	const vectors = await embed(domia, [value, ...candidates.map((c) => c.value)])
	if (vectors?.length !== candidates.length + 1) return null
	const query = vectors[0]
	const threshold = dedupThreshold(relation)
	let best: { id: string; confidence: number | null } | null = null
	let bestSim = 0
	for (let i = 0; i < candidates.length; i++) {
		const sim = cosineSim(query, vectors[i + 1])
		if (sim >= threshold && sim > bestSim) {
			bestSim = sim
			best = candidates[i]
		}
	}
	return best
}

const corroborate = async (
	factId: string,
	confidence: number | null,
	kind: FactKindEnumType,
	sourceInteractionId?: string,
): Promise<void> => {
	if (!sourceInteractionId) return
	await dbAdapter.addFactEvidence({
		id: generateUuid(),
		factId,
		sourceInteractionId,
	})
	const distinct = await dbAdapter.countFactEvidence(factId)
	if (distinct < CORROBORATION_MIN_DISTINCT_SOURCES) return
	const promoted = confFloor(kind) + CORROBORATED_CONFIDENCE_MARGIN
	if ((confidence ?? 0) < promoted)
		await dbAdapter.setFactConfidence(factId, promoted)
}

const enteringConfidence = (
	kind: FactKindEnumType,
	claimed: number | undefined,
): number => {
	const base = claimed ?? DEFAULT_FACT_CONFIDENCE
	if (kind === FACT_KIND_ENUM.OBSERVATION)
		return Math.min(base, OBSERVATION_QUARANTINE_CONFIDENCE)
	return Math.max(base, confFloor(kind))
}

const reconcileDeletes = async (
	domia: DomiaType,
	deletes: {
		subject: string
		relation: string
		value: string
		explicit?: boolean
	}[],
): Promise<number> => {
	if (!deletes.length) return 0
	const rows = await dbAdapter.getFactsForDomia(domia.id)
	let removed = 0
	for (const del of deletes) {
		for (const row of rows) {
			if (row.supersededAt) continue
			if (canonicalSubject(row.subject) !== del.subject) continue
			if (normalizeFactKey(row.relation) !== del.relation) continue
			if (
				!del.explicit &&
				row.confidence >= IDENTITY_PROTECT_FLOOR &&
				row.kind === FACT_KIND_ENUM.USER_FACT
			)
				continue
			const rowVal = normalizeFactKey(row.value)
			if (rowVal.includes(del.value) || del.value.includes(rowVal)) {
				await dbAdapter.supersedeFact(row.id)
				removed += 1
			}
		}
	}
	return removed
}

export const upsertFacts = async (
	domia: DomiaType,
	facts: RawFactType[],
	sourceInteractionId?: string,
): Promise<void> => {
	if (!facts.length) return
	const stopwords = languageSetsFor(domia.characterProfile?.language).stopwords
	const deletes: {
		subject: string
		relation: string
		value: string
		explicit?: boolean
	}[] = []
	const seen = new Set<string>()
	const rejected: string[] = []
	let stored = 0
	let corroborated = 0
	for (const fact of facts) {
		const subject = canonicalSubject(fact.subject)
		const relation = normalizeFactKey(fact.relation)
		const value = stripBrackets(sanitizeFactLine(fact.value).text)
		if (!subject || !relation || !value) continue
		if (fact.op === "delete") {
			deletes.push({
				subject,
				relation,
				value: normalizeFactKey(value),
				explicit: fact.explicit,
			})
			continue
		}
		const reason = rejectFact(subject, relation, value, stopwords)
		if (reason) {
			rejected.push(`${subject} ${relation} ${value} (${reason})`)
			continue
		}
		const valueKey = normalizeFactKey(value)
		const dedupKey = `${subject}|${relation}|${valueKey}`
		if (seen.has(dedupKey)) continue
		seen.add(dedupKey)
		const kind = classifyFactKind(fact.relation)
		const active = await dbAdapter.getActiveFactsFor(
			domia.id,
			subject,
			relation,
		)
		const keyed = await dbAdapter.findFactByKey(
			domia.id,
			subject,
			relation,
			valueKey,
		)
		if (keyed && !keyed.supersededAt) {
			await corroborate(keyed.id, keyed.confidence, kind, sourceInteractionId)
			corroborated += 1
			continue
		}
		const validity = resolveFactValidity(fact.when)
		if (keyed?.supersededAt) {
			const entering = enteringConfidence(kind, fact.confidence)
			dbClient.transaction((tx) => {
				if (SINGLE_VALUED_RELATIONS.has(relation))
					dbAdapter.supersedeActiveFacts(domia.id, subject, relation, tx).run()
				dbAdapter.reactivateFact(keyed.id, entering, validity, tx).run()
			})
			if (sourceInteractionId)
				await dbAdapter.addFactEvidence({
					id: generateUuid(),
					factId: keyed.id,
					sourceInteractionId,
				})
			stored += 1
			continue
		}
		const duplicate = await findSemanticDuplicate(
			domia,
			value,
			active.map((row) => ({
				id: row.id,
				value: row.value,
				confidence: row.confidence,
			})),
			relation,
		)
		if (duplicate) {
			await corroborate(
				duplicate.id,
				duplicate.confidence,
				kind,
				sourceInteractionId,
			)
			corroborated += 1
			continue
		}
		const id = generateUuid()
		const insertData = {
			id,
			domiaId: domia.id,
			subject,
			relation,
			value,
			valueKey,
			confidence: enteringConfidence(kind, fact.confidence),
			kind,
			sourceKind: FACT_SOURCE_KIND_ENUM.STATED,
			personId: null,
			sourceInteractionId: sourceInteractionId ?? null,
			validFrom: validity.validFrom,
			validUntil: validity.validUntil,
		}
		if (SINGLE_VALUED_RELATIONS.has(relation)) {
			dbClient.transaction((tx) => {
				dbAdapter.supersedeActiveFacts(domia.id, subject, relation, tx).run()
				dbAdapter.insertOrReactivateFact(insertData, tx).run()
			})
		} else {
			await dbAdapter.insertFact(insertData)
		}
		const inserted = await dbAdapter.findFactByKey(
			domia.id,
			subject,
			relation,
			valueKey,
		)
		const evidenceTarget = SINGLE_VALUED_RELATIONS.has(relation)
			? inserted?.id
			: inserted?.id === id
				? id
				: undefined
		if (evidenceTarget && sourceInteractionId)
			await dbAdapter.addFactEvidence({
				id: generateUuid(),
				factId: evidenceTarget,
				sourceInteractionId,
			})
		stored += 1
	}
	const removed = await reconcileDeletes(domia, deletes)
	memoryLogger.info("🧠 facts stored", {
		domiaId: domia.id,
		count: stored,
		corroborated,
		removed,
		...(rejected.length ? { rejected } : {}),
		facts: facts.map(
			(f) =>
				`${f.op === "delete" ? "-" : ""}${f.subject} ${f.relation} ${f.value}`,
		),
	})
}

export const auditStoredFacts = async (
	domia: DomiaType,
): Promise<{ row: SelectMemoryFactType; reason: string }[]> => {
	const stopwords = languageSetsFor(domia.characterProfile?.language).stopwords
	const rows = await dbAdapter.getFactsForDomia(domia.id)
	const garbage: { row: SelectMemoryFactType; reason: string }[] = []
	for (const row of rows) {
		if (row.supersededAt) continue
		const subject = canonicalSubject(row.subject)
		const relation = normalizeFactKey(row.relation)
		const value = stripBrackets(sanitizeFactLine(row.value).text)
		const reason = value
			? rejectFact(subject, relation, value, stopwords)
			: "value empty"
		if (reason) garbage.push({ row, reason })
	}
	return garbage
}

export const deleteStoredFacts = async (ids: string[]): Promise<number> => {
	let removed = 0
	for (const id of ids) {
		await dbAdapter.deleteFactById(id)
		removed += 1
	}
	return removed
}

export const getActiveFactRefs = async (
	domia: DomiaType,
): Promise<{ subject: string; relation: string; value: string }[]> => {
	try {
		const rows = await dbAdapter.getRecentFacts(
			domia.id,
			MEMORY_FACT_CANDIDATE_LIMIT,
		)
		return rows.map(({ subject, relation, value }) => ({
			subject,
			relation,
			value,
		}))
	} catch {
		return []
	}
}

// order must stay oldest-first/expired-last so the prompt prefix stays KV-cache stable
const recallFactStrings = async (
	domia: DomiaType,
	expiredLimit: number,
): Promise<string[]> => {
	try {
		const rows = await dbAdapter.getRecallFacts(
			domia.id,
			MEMORY_FACT_CANDIDATE_LIMIT,
			expiredLimit,
			staleInferredFactCutoff(domia),
		)
		return renderFactRecallLines(
			rows.filter((row) => row.confidence >= confFloor(row.kind)),
			domia.characterProfile?.language,
		)
	} catch {
		return []
	}
}

export const getFactStrings = (domia: DomiaType): Promise<string[]> =>
	recallFactStrings(domia, MEMORY_FACT_EXPIRED_CANDIDATE_LIMIT)

export const getActiveFactStrings = (domia: DomiaType): Promise<string[]> =>
	recallFactStrings(domia, 0)

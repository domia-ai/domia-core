import type { DomiaType } from "@/modules/core"
import { embed } from "@/modules/embeddings"
import {
	generateUuid,
	memoryLogger,
	languageSetsFor,
	sanitizeFactLine,
} from "@/utils"

import { FACT_KIND_ENUM, type FactKindEnumType } from "@/db"
import dbAdapter from "../db-adapter"
import { factsArraySchema } from "../schemas"
import {
	MEMORY_FACT_CANDIDATE_LIMIT,
	MEMORY_FACT_EXTRACT_MAX,
	DEFAULT_FACT_CONFIDENCE,
	MIN_RECALL_CONF_USER,
	MIN_RECALL_CONF_PREF,
	MIN_RECALL_CONF_OBS,
	KB_CANDIDATE_LIMIT,
} from "../constants"
import type { RawFactType } from "../types"

const PREFERENCE_RE = /prefer|like|love|enjoy|favou?rite|hate|dislike|want/i
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

const tokensOf = (s: string, stopwords: Set<string>): string[] =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 3 && !stopwords.has(w))

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
	const q = new Set(tokensOf(queryText, stopwords))
	if (q.size === 0) return facts.slice(0, limit)
	const scored = facts.map((fact, index) => {
		const ft = tokensOf(fact, stopwords)
		let rel = 0
		for (const t of ft) if (q.has(t)) rel++
		return { fact, index, rel }
	})
	const maxRel = scored.reduce((m, s) => Math.max(m, s.rel), 0)
	if (maxRel === 0) return facts.slice(0, limit)
	return scored
		.sort((a, b) => b.rel - a.rel || a.index - b.index)
		.slice(0, limit)
		.map((s) => s.fact)
}

export const rankFactsByRelevance = async (
	domia: DomiaType,
	facts: string[],
	queryText: string,
	limit: number,
): Promise<string[]> => {
	if (facts.length === 0) return facts
	const stopwords = languageSetsFor(domia.characterProfile?.language).stopwords
	if (facts.length <= limit)
		return rankFactsLexical(facts, queryText, limit, stopwords)
	const vectors = await embed(domia, [queryText, ...facts])
	if (!vectors || vectors.length !== facts.length + 1)
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
		const interests = (row.interests ?? []).filter((s) => s?.trim())
		if (interests.length) parts.push(`They're into ${interests.join(", ")}.`)
		const prefs = (row.prefs ?? []).filter((s) => s?.trim())
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

export const getFactsSince = (domiaId: string, since: string, limit: number) =>
	dbAdapter.getFactsSince(domiaId, since, limit)

export const getLastFactAt = async (domiaId: string) => {
	const row = await dbAdapter.getLastFactAt(domiaId)
	return row?.updatedAt ?? null
}

export const buildFactExtractionLines = (): string[] => [
	`Also extract durable facts the person EXPLICITLY stated about themselves. Format as objects {subject, relation, value, confidence}: "subject" is ALWAYS exactly "the user" (never "the user said X", never their name as the subject); "relation" is short lowercase (e.g. "is named", "is allergic to", "likes", "dislikes"); "value" is the plain detail with NO brackets or quotes (e.g. Kevin, green tea); "confidence" is 0..1.`,
	`DO capture clear first-person declarations: "my name is Kevin" → {subject:"the user", relation:"is named", value:"Kevin"}; "I love green tea" / "green tea is my favorite" → {subject:"the user", relation:"likes", value:"green tea"}; "I can't stand coffee" → {subject:"the user", relation:"dislikes", value:"coffee"}; "I'm allergic to peanuts" → {subject:"the user", relation:"is allergic to", value:"peanuts"}. Preferences, name, allergies, relationships, and plans they state ARE facts — capture them.`,
	`When the person RETRACTS or REVERSES something ("I quit coffee", "I no longer like tea", "I switched from X to Y", "actually I can't stand it anymore"), emit a retraction with "op":"delete" for the OLD fact ({subject:"the user", relation:"likes", value:"coffee", op:"delete"}) — and for a switch also add the NEW fact. Default op is "add"; only set "delete" for an explicit retraction.`,
	`NEVER create a fact from: (a) a QUESTION they asked — "do you have a spa?" does NOT mean they like spas; (b) YOUR reply or suggestions — recommending an action movie does NOT mean they like action movies; (c) anything about you, the assistant, or Domia. If they only asked a question or made small talk, return [].`,
]

export const parseFacts = (input: unknown): RawFactType[] => {
	const result = factsArraySchema.safeParse(input)
	if (!result.success) return []
	return result.data
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

const reconcileDeletes = async (
	domia: DomiaType,
	deletes: { subject: string; value: string }[],
): Promise<number> => {
	if (!deletes.length) return 0
	const rows = await dbAdapter.getFactsForDomia(domia.id)
	let removed = 0
	for (const del of deletes) {
		for (const row of rows) {
			if (canonicalSubject(row.subject) !== del.subject) continue
			if (
				(row.confidence ?? 0) >= IDENTITY_PROTECT_FLOOR &&
				row.kind === FACT_KIND_ENUM.USER_FACT
			)
				continue
			const rowVal = normalizeFactKey(row.value)
			if (rowVal.includes(del.value) || del.value.includes(rowVal)) {
				await dbAdapter.deleteFactById(row.id)
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
	const deletes: { subject: string; value: string }[] = []
	const seen = new Set<string>()
	let stored = 0
	for (const fact of facts) {
		const subject = canonicalSubject(fact.subject)
		const relation = normalizeFactKey(fact.relation)
		const value = stripBrackets(sanitizeFactLine(fact.value).text)
		if (!subject || !relation || !value) continue
		if (fact.op === "delete") {
			deletes.push({ subject, value: normalizeFactKey(value) })
			continue
		}
		const dedupKey = `${subject}|${relation}`
		if (seen.has(dedupKey)) continue
		seen.add(dedupKey)
		await dbAdapter.upsertFact({
			id: generateUuid(),
			domiaId: domia.id,
			subject,
			relation,
			value,
			confidence: fact.confidence ?? DEFAULT_FACT_CONFIDENCE,
			kind: classifyFactKind(fact.relation),
			sourceInteractionId: sourceInteractionId ?? null,
		})
		stored += 1
	}
	const removed = await reconcileDeletes(domia, deletes)
	memoryLogger.info("🧠 facts stored", {
		domiaId: domia.id,
		count: stored,
		removed,
		facts: facts.map(
			(f) =>
				`${f.op === "delete" ? "-" : ""}${f.subject} ${f.relation} ${f.value}`,
		),
	})
}

export const getFactStrings = async (domia: DomiaType): Promise<string[]> => {
	try {
		const rows = await dbAdapter.getRecentFacts(
			domia.id,
			MEMORY_FACT_CANDIDATE_LIMIT,
		)
		return rows
			.filter(
				(row) =>
					(row.confidence ?? 0) >=
					confFloor(
						(row.kind ?? FACT_KIND_ENUM.OBSERVATION) as FactKindEnumType,
					),
			)
			.map(
				(row) =>
					sanitizeFactLine(`${row.subject} ${row.relation} ${row.value}`).text,
			)
	} catch {
		return []
	}
}

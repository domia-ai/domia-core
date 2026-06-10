import type { DomiaType } from "@/modules/core"
import { generateUuid, memoryLogger } from "@/utils"

import dbAdapter from "../db-adapter"
import { factsArraySchema } from "../schemas"
import {
	MEMORY_FACT_RECALL_LIMIT,
	MEMORY_FACT_EXTRACT_MAX,
	DEFAULT_FACT_CONFIDENCE,
	MIN_RECALL_CONFIDENCE,
} from "../constants"
import type { RawFactType } from "../types"

export const getFactsSince = (domiaId: string, since: string, limit: number) =>
	dbAdapter.getFactsSince(domiaId, since, limit)

export const getLastFactAt = async (domiaId: string) => {
	const row = await dbAdapter.getLastFactAt(domiaId)
	return row?.updatedAt ?? null
}

export const buildFactExtractionLines = (): string[] => [
	`Also look for a durable fact the person EXPLICITLY stated about themselves. Most turns have NONE — when unsure, use []. Format as objects {subject, relation, value, confidence}: "subject" is the person (e.g. "the user"); "relation" is short (e.g. "is named", "is allergic to", "prefers"); "value" is the detail; "confidence" is 0..1.`,
	`Record a fact ONLY if the person literally declared personal information in "The person said" (a name they gave, a preference/allergy/relationship/plan they stated). NEVER create a fact from: (a) a QUESTION they asked — "do you have a spa?" does NOT mean they like spas, "why's your name?" is NOT their name; (b) YOUR reply or suggestions — recommending an action movie does NOT mean they like action movies; (c) anything about you, the assistant, or Domia — facts are only about the person. If they only asked a question or made small talk, return [].`,
]

export const parseFacts = (input: unknown): RawFactType[] => {
	const result = factsArraySchema.safeParse(input)
	if (!result.success) return []
	return result.data
		.filter((f) => f.subject.trim() && f.relation.trim() && f.value.trim())
		.slice(0, MEMORY_FACT_EXTRACT_MAX)
}

export const upsertFacts = async (
	domia: DomiaType,
	facts: RawFactType[],
	sourceInteractionId?: string,
): Promise<void> => {
	if (!facts.length) return
	for (const fact of facts) {
		await dbAdapter.upsertFact({
			id: generateUuid(),
			domiaId: domia.id,
			subject: fact.subject.trim(),
			relation: fact.relation.trim(),
			value: fact.value.trim(),
			confidence: fact.confidence ?? DEFAULT_FACT_CONFIDENCE,
			sourceInteractionId: sourceInteractionId ?? null,
		})
	}
	memoryLogger.info("🧠 facts stored", {
		domiaId: domia.id,
		count: facts.length,
		facts: facts.map((f) => `${f.subject} ${f.relation} ${f.value}`),
	})
}

export const getFactStrings = async (domia: DomiaType): Promise<string[]> => {
	try {
		const rows = await dbAdapter.getRecentFacts(
			domia.id,
			MEMORY_FACT_RECALL_LIMIT,
		)
		return rows
			.filter((row) => (row.confidence ?? 0) >= MIN_RECALL_CONFIDENCE)
			.map((row) => `${row.subject} ${row.relation} ${row.value}`)
	} catch {
		return []
	}
}

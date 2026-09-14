import {
	filterReflectionFacts,
	isSelfDescriptionTurn,
	shouldRetryFactExtraction,
} from "@/modules/reflection"
import {
	classifyFactKind,
	isPastTenseQuery,
	rankFactsByRelevance,
	rejectFact,
	renderFactRecallLines,
	resolveFactValidity,
	staleInferredFactCutoff,
	SINGLE_VALUED_RELATIONS,
} from "@/modules/memory"
import type { FactRecallRowType, RawFactType } from "@/modules/memory"
import type { DomiaType } from "@/modules/core"
import type { PersonaContextType } from "@/modules/prompt-context-builder"
import { languageSetsFor, parseDbTimestamp } from "@/utils"

import { makeChecker } from "./lib"

const checker = makeChecker()

const persona = {
	characterProfile: { name: "Domia" },
} as unknown as PersonaContextType

const stopwords = languageSetsFor("en").stopwords

const fact = (relation: string, value: string): RawFactType => ({
	subject: "the user",
	relation,
	value,
})

const kept = (
	facts: RawFactType[],
	userText: string,
	replyText: string,
): string[] =>
	filterReflectionFacts(facts, userText, replyText, persona).map(
		(f) => `${f.relation}|${f.value}`,
	)

const esPersona = {
	...persona,
	characterProfile: { ...(persona.characterProfile ?? {}), language: "es" },
} as unknown as PersonaContextType

const NOW_AT = Date.parse("2026-09-11T12:00:00Z")
const FORMERLY = languageSetsFor("en").phrases.formerly

const recallRow = (
	relation: string,
	value: string,
	closed = false,
): FactRecallRowType => ({
	subject: "the user",
	relation,
	value,
	validUntil: closed ? "2026-09-11 11:00:00.000" : null,
	supersededAt: closed ? "2026-09-11 11:00:00.000" : null,
})

const recallDomia = (overrides: {
	language?: string
	includeExpired?: boolean
	maxAgeDays?: number | null
}): DomiaType =>
	({
		characterProfile: { language: overrides.language ?? "en" },
		moduleSettings: {
			memoryRecallIncludeExpired: overrides.includeExpired ?? false,
			memoryFactMaxAgeDays: overrides.maxAgeDays ?? null,
		},
	}) as unknown as DomiaType

const RECALL_LIMIT = 20

const temporalChecks = async (): Promise<void> => {
	const nowValidity = resolveFactValidity(undefined, NOW_AT)
	checker.check(
		"a plain declaration opens an interval that never ends",
		nowValidity.validUntil === null &&
			parseDbTimestamp(nowValidity.validFrom) === NOW_AT,
	)
	const pastValidity = resolveFactValidity("past", NOW_AT)
	checker.check(
		"a past-tense declaration closes its interval at now",
		pastValidity.validUntil !== null &&
			parseDbTimestamp(pastValidity.validUntil) === NOW_AT,
	)
	checker.check(
		"a future plan stays open-ended",
		resolveFactValidity("future", NOW_AT).validUntil === null,
	)
	const dated = resolveFactValidity("2026-12-01", NOW_AT)
	checker.check(
		"a stated date becomes validFrom and leaves the interval open",
		dated.validUntil === null &&
			parseDbTimestamp(dated.validFrom) === Date.parse("2026-12-01"),
	)
	checker.check(
		"an unparseable when falls back to an open interval starting now",
		resolveFactValidity("alguna vez", NOW_AT).validUntil === null,
	)

	const changed = renderFactRecallLines(
		[recallRow("likes", "tea"), recallRow("likes", "coffee", true)],
		"en",
		NOW_AT,
	)
	checker.check(
		"a superseded single-valued value renders as formerly, the new one plainly",
		changed.some((l) => l === "the user likes tea") &&
			changed.some((l) => l === `${FORMERLY} the user likes coffee`),
	)
	checker.check(
		"expired lines are appended last so the prompt prefix stays stable",
		changed.findIndex((l) => l.startsWith(FORMERLY)) === changed.length - 1,
	)
	checker.check(
		"the expired marker is localized",
		renderFactRecallLines(
			[recallRow("likes", "cafe", true)],
			"es",
			NOW_AT,
		)[0].startsWith(languageSetsFor("es").phrases.formerly),
	)

	const domia = recallDomia({})
	const recalled = await rankFactsByRelevance(
		domia,
		changed,
		"what do I drink?",
		RECALL_LIMIT,
	)
	checker.check(
		"expired facts are excluded from recall by default",
		recalled.includes("the user likes tea") &&
			!recalled.some((l) => l.startsWith(FORMERLY)),
	)
	const pastRecalled = await rankFactsByRelevance(
		domia,
		changed,
		"what did I used to drink?",
		RECALL_LIMIT,
	)
	checker.check(
		"a question about the past surfaces the formerly line",
		pastRecalled.some((l) => l === `${FORMERLY} the user likes coffee`),
	)
	const knobRecalled = await rankFactsByRelevance(
		recallDomia({ includeExpired: true }),
		changed,
		"what do I drink?",
		RECALL_LIMIT,
	)
	checker.check(
		"memoryRecallIncludeExpired surfaces expired facts on any query",
		knobRecalled.some((l) => l.startsWith(FORMERLY)),
	)

	checker.check(
		"english past-tense cues are detected",
		isPastTenseQuery("did I ever like coffee?", "en") &&
			isPastTenseQuery("what did I used to drink?", "en") &&
			!isPastTenseQuery("what do I drink?", "en"),
	)
	checker.check(
		"spanish past-tense cues are detected",
		isPastTenseQuery("¿qué solía beber?", "es") &&
			!isPastTenseQuery("¿qué bebo?", "es"),
	)

	checker.check(
		"memoryFactMaxAgeDays null means inferred facts never go stale",
		staleInferredFactCutoff(recallDomia({})) === null,
	)
	const cutoff = staleInferredFactCutoff(recallDomia({ maxAgeDays: 30 }))
	checker.check(
		"memoryFactMaxAgeDays yields a cutoff that many days back",
		cutoff !== null &&
			Math.abs(Date.now() - parseDbTimestamp(cutoff) - 30 * 86_400_000) < 5_000,
	)

	checker.check(
		"a stated consumption relation is a preference, not a quarantined observation",
		classifyFactKind("drinks") === "preference" &&
			classifyFactKind("listens to") === "preference" &&
			classifyFactKind("celebrates") === "observation",
	)

	checker.check(
		"an inverted-polarity relation is dropped for a past-tense preference",
		kept(
			[fact("dislikes", "coffee"), fact("dislikes", "tea")],
			"I used to like coffee, now I only drink tea.",
			"You like tea now.",
		).length === 0,
	)
	checker.check(
		"the polarity the user actually used survives",
		kept(
			[fact("drinks", "tea"), fact("likes", "coffee")],
			"I used to like coffee, now I only drink tea.",
			"You like tea now.",
		).join() === "drinks|tea,likes|coffee",
	)
	checker.check(
		"a genuine dislike backed by a negative cue is kept",
		kept(
			[fact("dislikes", "coffee")],
			"I can't stand coffee.",
			"Noted.",
		).join() === "dislikes|coffee" &&
			kept([fact("dislikes", "tea")], "I don't like tea.", "Noted.").join() ===
				"dislikes|tea",
	)
	checker.check(
		"a spanish dislike backed by a spanish cue is kept, an unbacked one dropped",
		filterReflectionFacts(
			[fact("dislikes", "café")],
			"no me gusta el café",
			"Entendido.",
			esPersona,
		).length === 1 &&
			filterReflectionFacts(
				[fact("dislikes", "té")],
				"antes me gustaba el café, ahora solo bebo té",
				"Té entonces.",
				esPersona,
			).length === 0,
	)
	checker.check(
		"a past-tense switch takes the priority reflection lane",
		isSelfDescriptionTurn("I used to like coffee, now I only drink tea.", "en"),
	)

	checker.check(
		"a third-party fact keeps the speaker as subject and survives grounding",
		kept(
			[fact("has a sister named", "Elena")],
			"My sister's name is Elena.",
			"Elena, noted.",
		).join() === "has a sister named|Elena" &&
			rejectFact("the user", "has a sister named", "Elena", stopwords) === null,
	)
	checker.check(
		"a past-tense declaration keeps its when through the grounding filter",
		filterReflectionFacts(
			[
				{
					subject: "the user",
					relation: "lives in",
					value: "Bogotá",
					when: "past",
					op: "add",
				},
			],
			"I used to live in Bogotá.",
			"Bogotá is lovely.",
			persona,
		)[0]?.when === "past",
	)
}

const main = async (): Promise<void> => {
	checker.check(
		"assistant joke content is not attributed to the user",
		kept(
			[fact("likes", "skeletons")],
			"Tell me a joke.",
			"Why don't skeletons fight each other? They don't have the guts.",
		).length === 0,
	)

	checker.check(
		"a value the user actually said survives an echoing reply",
		kept(
			[fact("has favorite color", "blue")],
			"My favorite color is blue.",
			"Blue is a lovely colour!",
		).join() === "has favorite color|blue",
	)

	checker.check(
		"one incidental substring token no longer grounds a fact",
		kept(
			[fact("likes", "old family jokes")],
			"I told you about the joke my brother made",
			"Your brother sounds funny.",
		).length === 0,
	)

	checker.check(
		"a hallucinated relation is dropped even when the value is grounded",
		kept([fact("owns", "blue")], "My favorite color is blue.", "Noted.")
			.length === 0,
	)

	checker.check(
		"the relation the user actually named is kept",
		kept(
			[fact("has favorite color", "blue")],
			"My favorite color is blue.",
			"Noted.",
		).join() === "has favorite color|blue",
	)

	checker.check(
		"a taught relation survives a language that does not echo it",
		kept(
			[fact("is named", "Kevin")],
			"me llamo Kevin",
			"Kevin, lo recuerdo.",
		).join() === "is named|Kevin",
	)

	checker.check(
		"a favorite attribute passes rejectFact with its relation intact",
		rejectFact("the user", "has favorite color", "blue", stopwords) === null,
	)

	checker.check(
		"a favorite colour is single-valued so a new one supersedes",
		SINGLE_VALUED_RELATIONS.has("has favorite color") &&
			SINGLE_VALUED_RELATIONS.has("has favourite colour"),
	)

	checker.check(
		"an open-ended favorite stays multi-valued",
		!SINGLE_VALUED_RELATIONS.has("has favorite food"),
	)

	const retryInput = {
		factsEnabled: true,
		explicitMemory: false,
		hasReflectionModel: true,
		userText: "My favorite color is blue.",
	}
	checker.check(
		"every candidate rejected triggers the main-model retry",
		shouldRetryFactExtraction({ ...retryInput, keptCount: 0 }),
	)
	checker.check(
		"a surviving fact does not trigger the retry",
		!shouldRetryFactExtraction({ ...retryInput, keptCount: 1 }),
	)
	checker.check(
		"a pure question never triggers the retry",
		!shouldRetryFactExtraction({
			...retryInput,
			keptCount: 0,
			userText: "What time is it?",
		}),
	)

	checker.check(
		"a preference relation is kept when the user text carries a preference cue",
		kept(
			[
				{
					subject: "the user",
					relation: "has favorite music",
					value: "jazz",
					op: "add",
				},
			],
			"I love jazz music, it relaxes me",
			"Jazz is wonderful.",
		).includes("has favorite music|jazz"),
	)
	checker.check(
		"an activity-worded preference is kept when the cue is present",
		kept(
			[
				{
					subject: "the user",
					relation: "has a favorite drink",
					value: "green tea",
					op: "add",
				},
			],
			"Actually I've stopped drinking coffee, I only drink green tea",
			"Noted, green tea it is.",
		).includes("has a favorite drink|green tea"),
	)
	checker.check(
		"an ownership relation without an ownership cue is still dropped",
		!kept(
			[{ subject: "the user", relation: "owns", value: "blue", op: "add" }],
			"my favorite color is blue",
			"Blue is a lovely colour!",
		).includes("owns|blue"),
	)
	checker.check(
		"a relation outside every family with no textual support is dropped",
		!kept(
			[
				{
					subject: "the user",
					relation: "is buying",
					value: "eggs",
					op: "add",
				},
			],
			"add eggs and milk to my shopping list",
			"Added.",
		).includes("is buying|eggs"),
	)
	checker.check(
		"spanish cues ground a preference relation for a spanish persona",
		filterReflectionFacts(
			[{ subject: "the user", relation: "likes", value: "el jazz", op: "add" }],
			"me encanta el jazz",
			"Qué bien.",
			{
				...persona,
				characterProfile: {
					...(persona.characterProfile ?? {}),
					language: "es",
				},
			},
		).length === 1,
	)

	checker.check(
		"a mid-sentence name declaration survives an echoing reply",
		kept(
			[fact("is named", "Marta")],
			"By the way, my name is Marta.",
			"Marta.",
		).join() === "is named|Marta",
	)
	checker.check(
		"a spanish name declaration survives for a spanish persona",
		filterReflectionFacts(
			[fact("is named", "Marta")],
			"Por cierto, me llamo Marta.",
			"Hola, Marta.",
			{
				...persona,
				characterProfile: {
					...(persona.characterProfile ?? {}),
					language: "es",
				},
			},
		)
			.map((f) => `${f.relation}|${f.value}`)
			.join() === "is named|Marta",
	)
	checker.check(
		"a name declaration takes the priority reflection lane",
		isSelfDescriptionTurn("By the way, my name is Marta.", "en"),
	)
	checker.check(
		"a spanish name declaration takes the priority lane for a spanish identity",
		isSelfDescriptionTurn("Por cierto, me llamo Marta.", "es"),
	)
	checker.check(
		"a preference declaration takes the priority lane",
		isSelfDescriptionTurn(
			"I love jazz music, especially in the evening.",
			"en",
		),
	)
	checker.check(
		"a recall question never takes the priority lane",
		!isSelfDescriptionTurn("What's my name?", "en") &&
			!isSelfDescriptionTurn(
				"Before we finish — what's my favourite music?",
				"en",
			),
	)
	checker.check(
		"a device command never takes the priority lane",
		!isSelfDescriptionTurn("Turn on the office lights", "en"),
	)
	checker.check(
		"an unknown language falls back to the english cues",
		isSelfDescriptionTurn("My name is Marta.", "zz"),
	)

	checker.check(
		"a first-person preference declaration takes the priority lane (en)",
		isSelfDescriptionTurn(
			"Actually I've stopped drinking coffee, I only drink green tea",
			"en",
		),
	)
	checker.check(
		"a first-person preference declaration takes the priority lane (es)",
		isSelfDescriptionTurn("me encanta el jazz por las noches", "es"),
	)
	checker.check(
		"a device command never takes the priority lane",
		!isSelfDescriptionTurn("turn off the kitchen lights", "en"),
	)
	await temporalChecks()

	console.log(
		`\nreflection extraction: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	if (checker.failCount() > 0) process.exit(1)
}

void main()

import { configSchema } from "@/modules/config-engine/schemas"
import {
	SUPPORTED_LANGUAGES,
	anaphoraCandidate,
	applyAnaphora,
	languageSetsFor,
	registerCatalogExtension,
	registerLanguageCatalog,
} from "@/utils/language-catalogs"
import type { LanguageCatalogType } from "@/utils/language-catalogs"

import { makeChecker } from "./lib"
import { stateQuestionHit } from "@/modules/intent-router"

const SYNTHETIC_CODE = "xx"
const SYNTHETIC_KIND = "zub"

const validConfig = (language: string): Record<string, unknown> => ({
	domiaKey: "EVAL",
	name: "eval",
	language,
	languagesSpoken: [language],
})

const syntheticCatalogFromEn = (): LanguageCatalogType => {
	const en = languageSetsFor("en")
	return {
		displayName: "Synthetic",
		locale: "en-US",
		latinScript: false,
		spokenTime: en.spokenTime,
		interruptPhrases: [...en.interruptPhrases],
		articles: ["zub"],
		stopwords: [...en.stopwords],
		numberWords: { ...en.numberWords },
		numberJoiners: [...en.numberJoiners],
		percentWords: [...en.percentWords],
		questionStarters: [...en.questionStarters],
		requestModals: [...en.requestModals],
		conjunctions: [...en.conjunctions],
		additiveCues: [...en.additiveCues],
		timerKeywords: ["timer", "alarm"],
		memoryCommandKeywords: ["remember", "forget"],
		unitWords: { ...en.unitWords },
		affirmations: ["yar", "aye"],
		negations: ["nay"],
		fastPathBlockers: [...en.fastPathBlockers],
		routingBlockers: [...en.routingBlockers],
		personalQuestionMarkers: [...en.personalQuestionMarkers],
		stateQuestionMarkers: ["zub encendido"],
		retryCues: ["zub otra vez"],
		anaphoraRewrites: [{ pattern: "^wub it$", template: "wub {entity}" }],
		phrases: { done: "Zub done." },
	}
}

const run = (): void => {
	const c = makeChecker()

	console.log("\nregistry")
	c.check(
		"en and es are catalog keys",
		["en", "es"].every((k) => SUPPORTED_LANGUAGES.has(k)),
	)
	c.check(
		"unknown code not supported before registration",
		!SUPPORTED_LANGUAGES.has(SYNTHETIC_CODE),
	)
	c.check(
		"unknown code resolves to en before registration",
		languageSetsFor(SYNTHETIC_CODE).displayName === "English",
	)
	c.check(
		"config schema rejects unknown language",
		!configSchema.safeParse(validConfig(SYNTHETIC_CODE)).success,
	)
	c.check(
		"config schema accepts en and es",
		["en", "es"].every((l) => configSchema.safeParse(validConfig(l)).success),
	)

	registerLanguageCatalog(SYNTHETIC_CODE, syntheticCatalogFromEn())
	const xx = languageSetsFor(SYNTHETIC_CODE)

	console.log("\nsynthetic third catalog")
	c.check(
		"registered code becomes supported",
		SUPPORTED_LANGUAGES.has(SYNTHETIC_CODE),
	)
	c.check(
		"languageSetsFor resolves the synthetic catalog",
		xx.displayName === "Synthetic",
	)
	c.check(
		"region suffix normalizes to the synthetic code",
		languageSetsFor("xx-ZZ").displayName === "Synthetic",
	)
	c.check(
		"config schema accepts the synthetic language once registered",
		configSchema.safeParse(validConfig(SYNTHETIC_CODE)).success,
	)
	c.check(
		"synthetic affirmations override en",
		xx.affirmations.has("yar") && !xx.affirmations.has("yes"),
	)
	c.check(
		"synthetic phrases fall back to en per key",
		xx.phrases.done === "Zub done." && xx.phrases.gotIt === "Got it.",
	)
	c.check("synthetic latinScript is honored", !xx.latinScript)
	c.check(
		"synthetic article regex strips its own article",
		"zub lamp".replace(xx.articlePrefixRe, "") === "lamp",
	)

	const en = languageSetsFor("en")
	const es = languageSetsFor("es")

	console.log("\nspoken time per language")
	const at = (h: number, m: number): Date => new Date(2026, 8, 2, h, m)
	c.check(
		"en spoken time keeps the historical form",
		en.spokenTime(at(16, 52)) === "four fifty-two in the afternoon" &&
			en.spokenTime(at(9, 0)) === "nine o'clock in the morning" &&
			en.spokenTime(at(0, 5)) === "twelve oh five in the morning",
	)
	c.check(
		"es spoken time is idiomatic",
		es.spokenTime(at(16, 52)) === "las cuatro y cincuenta y dos de la tarde" &&
			es.spokenTime(at(13, 15)) === "la una y cuarto de la tarde" &&
			es.spokenTime(at(21, 45)) === "las diez menos cuarto de la noche" &&
			es.spokenTime(at(12, 30)) === "las doce y media de la tarde",
	)
	c.check(
		"es date locale renders Spanish month names",
		new Intl.DateTimeFormat(es.locale, { month: "long" })
			.format(at(16, 52))
			.toLowerCase() === "septiembre",
	)
	c.check(
		"synthetic catalog inherits a spoken-time renderer",
		xx.spokenTime(at(16, 52)) === en.spokenTime(at(16, 52)),
	)

	console.log("\noverride vs merge")
	c.check(
		"es affirmations carry no en-only words",
		["yes", "yeah", "sure", "go ahead"].every((w) => !es.affirmations.has(w)),
	)
	c.check(
		"es affirmations keep native words",
		["si", "sí", "claro", "vale"].every((w) => es.affirmations.has(w)),
	)
	c.check(
		"es negations carry no en-only words",
		["nope", "cancel", "never mind"].every((w) => !es.negations.has(w)) &&
			es.negations.has("no"),
	)
	c.check(
		"es stopwords carry no en-only words",
		!es.stopwords.has("the") && es.stopwords.has("el"),
	)
	c.check(
		"en sets unchanged",
		en.affirmations.has("yes") &&
			en.negations.has("nope") &&
			en.stopwords.has("the"),
	)
	c.check(
		"numberWords stay merged for es",
		es.numberWords.dos === 2 && es.numberWords.two === 2,
	)
	c.check(
		"timer keywords stay merged for es",
		es.timerKeywordsRe.test("temporizador") && es.timerKeywordsRe.test("timer"),
	)
	c.check(
		"state-question markers stay merged for es",
		es.stateQuestionMarkers.includes("hay algo encendido") &&
			es.stateQuestionMarkers.includes("is anything still on"),
	)
	c.check(
		"retry cues stay merged for es",
		es.retryCues.includes("inténtalo de nuevo") &&
			es.retryCues.includes("try it again"),
	)
	c.check(
		"state-question openers and state words stay merged for es",
		es.stateQuestionOpeners.includes("están las") &&
			es.stateQuestionOpeners.includes("are the") &&
			es.stateWords.includes("encendidas") &&
			es.stateWords.includes("locked"),
	)

	console.log("\nstructural state questions")
	const structuralHits: [string, string][] = [
		["Are the kitchen island pendants on?", "en"],
		["Is my front door locked?", "en"],
		["is the bedroom TV still playing", "en"],
		["¿Están las luces de la cocina encendidas?", "es"],
		["¿Está la puerta del garaje cerrada con llave?", "es"],
	]
	for (const [text, lang] of structuralHits)
		c.check(`hit: ${text}`, stateQuestionHit(text, lang) !== null)
	const structuralMisses: [string, string][] = [
		["Turn the kitchen lights on", "en"],
		["Are the pendants on the island", "en"],
		["Is the kitchen a nice place to cook", "en"],
		["The office lights are on", "en"],
		["Enciende las luces de la cocina", "es"],
	]
	for (const [text, lang] of structuralMisses)
		c.check(`miss: ${text}`, stateQuestionHit(text, lang) === null)
	c.check(
		"synthetic catalog keeps its own markers plus the en fallback",
		xx.stateQuestionMarkers.includes("zub encendido") &&
			xx.stateQuestionMarkers.includes("is anything still on") &&
			xx.retryCues.includes("zub otra vez") &&
			xx.retryCues.includes("try it again"),
	)

	console.log("\narticle regex per language")
	c.check(
		"es regex strips la/el/los/las",
		["la luz", "el foco", "los focos", "las luces"].every(
			(s) => !/^(la|el|los|las) /.test(s.replace(es.articlePrefixRe, "")),
		),
	)
	c.check(
		"es regex keeps 'lampara' intact (no partial article)",
		"lampara".replace(es.articlePrefixRe, "") === "lampara",
	)
	c.check(
		"en regex does not strip es articles",
		["la luz", "el foco", "los focos", "las luces"].every(
			(s) => s.replace(en.articlePrefixRe, "") === s,
		),
	)
	c.check(
		"en regex strips the/my/our",
		["the lamp", "my lamp", "our lamp"].every(
			(s) => s.replace(en.articlePrefixRe, "") === "lamp",
		),
	)
	c.check(
		"es regex does not strip en articles",
		"the lamp".replace(es.articlePrefixRe, "") === "the lamp",
	)

	console.log("\nprovider-scoped anaphora rewrites")
	registerCatalogExtension(SYNTHETIC_KIND, {
		en: {
			anaphoraRewrites: [
				{ pattern: "^zub it$", template: "zub {entity}" },
				{ pattern: "^zub it (up|down)$", template: "zub {entity} $1" },
			],
		},
	})
	const scoped = languageSetsFor("en").anaphoraRewrites.filter(
		(r) => r.kind === SYNTHETIC_KIND,
	)
	c.check(
		"an extension rewrite carries the specialization kind",
		scoped.length === 2,
		`scoped=${scoped.length}`,
	)
	c.check(
		"the candidate pre-check ignores the kind",
		anaphoraCandidate("zub it", "en") && !anaphoraCandidate("nope it", "en"),
	)
	c.check(
		"a scoped rewrite fires when the last acted provider matches its kind",
		applyAnaphora("zub it", "en", {
			entity: "Thing",
			kind: SYNTHETIC_KIND,
		}) === "zub Thing",
	)
	c.check(
		"a scoped rewrite stays silent for another provider kind",
		applyAnaphora("zub it", "en", { entity: "Thing", kind: "other" }) === null,
	)
	c.check(
		"a scoped rewrite stays silent when the last acted provider has no kind",
		applyAnaphora("zub it", "en", { entity: "Thing", kind: null }) === null,
	)
	c.check(
		"capture groups survive the rewrite",
		applyAnaphora("zub it up", "en", {
			entity: "Thing",
			kind: SYNTHETIC_KIND,
		}) === "zub Thing up",
	)
	c.check(
		"an extension rewrite falls back to en for another language",
		applyAnaphora("zub it", SYNTHETIC_CODE, {
			entity: "Thing",
			kind: SYNTHETIC_KIND,
		}) === "zub Thing",
	)
	c.check(
		"a base-catalog rewrite applies to any last acted provider",
		applyAnaphora("wub it", SYNTHETIC_CODE, {
			entity: "Thing",
			kind: SYNTHETIC_KIND,
		}) === "wub Thing" &&
			applyAnaphora("wub it", SYNTHETIC_CODE, {
				entity: "Thing",
				kind: null,
			}) === "wub Thing",
	)
	c.check(
		"an unmatched transcript yields no rewrite",
		applyAnaphora("turn the lamp on", "en", {
			entity: "Thing",
			kind: SYNTHETIC_KIND,
		}) === null,
	)

	console.log("\ndisplay names + script")
	c.check(
		"en/es display names",
		en.displayName === "English" && es.displayName === "Spanish",
	)
	c.check("en/es are latin script", en.latinScript && es.latinScript)

	console.log(
		`\nlanguage-scaffold: ${c.passCount()} passed, ${c.failCount()} failed`,
	)
	if (c.failCount() > 0) process.exit(1)
}

run()

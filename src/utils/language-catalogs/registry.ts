import { RELATION_FAMILIES } from "@/modules/memory/constants"
import type { RelationFamilyType } from "@/modules/memory/types"
import type {
	AnaphoraRewriteType,
	ClockWordsType,
	LanguageCatalogExtensionType,
	LanguageCatalogType,
	ResolvedLanguageSetsType,
	ScopedAnaphoraRewriteType,
} from "./types"
import { EN } from "./data/en"
import { ES } from "./data/es"

const CATALOGS = new Map<string, LanguageCatalogType>([
	["en", EN],
	["es", ES],
])

const supportedLanguages = new Set(CATALOGS.keys())

export const SUPPORTED_LANGUAGES: ReadonlySet<string> = supportedLanguages

const resolvedCache = new Map<string, ResolvedLanguageSetsType>()

const extensions = new Map<
	string,
	Record<string, LanguageCatalogExtensionType>
>()

export const registerCatalogExtension = (
	kind: string,
	byLanguage: Record<string, LanguageCatalogExtensionType>,
): void => {
	extensions.set(kind, byLanguage)
	resolvedCache.clear()
}

const extensionsFor = (code: string): LanguageCatalogExtensionType[] =>
	[...extensions.values()].flatMap((byLanguage) => {
		const base = byLanguage.en
		const localized = code === "en" ? undefined : byLanguage[code]
		return [base, localized].filter(
			(ext): ext is LanguageCatalogExtensionType => ext !== undefined,
		)
	})

const extensionFor = (
	byLanguage: Record<string, LanguageCatalogExtensionType>,
	code: string,
): LanguageCatalogExtensionType | undefined => byLanguage[code]

const scopedRewrites = (
	rewrites: AnaphoraRewriteType[],
	kind: string | null,
): ScopedAnaphoraRewriteType[] =>
	rewrites.map((r) => ({
		re: new RegExp(r.pattern, "i"),
		template: r.template,
		kind,
	}))

const extensionRewrites = (code: string): ScopedAnaphoraRewriteType[] =>
	[...extensions.entries()].flatMap(([kind, byLanguage]) =>
		scopedRewrites(
			extensionFor(byLanguage, code)?.anaphoraRewrites ??
				extensionFor(byLanguage, "en")?.anaphoraRewrites ??
				[],
			kind,
		),
	)

const catalogRewrites = (
	catalog: LanguageCatalogType,
): ScopedAnaphoraRewriteType[] =>
	scopedRewrites(catalog.anaphoraRewrites ?? EN.anaphoraRewrites ?? [], null)

const languageCodeOf = (language: string): string =>
	language.trim().toLowerCase().split(/[-_]/)[0]

export const registerLanguageCatalog = (
	language: string,
	catalog: LanguageCatalogType,
): void => {
	const code = languageCodeOf(language)
	CATALOGS.set(code, catalog)
	supportedLanguages.add(code)
	resolvedCache.delete(code)
}

const normalizeLanguage = (language?: string | null): string => {
	const code = languageCodeOf(language ?? "en")
	return CATALOGS.has(code) ? code : "en"
}

const escapeRegex = (s: string): string =>
	s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const mergedWithEn = (own: string[], en: string[]): string[] => [
	...new Set([...en, ...own]),
]

const mergedDomainWords = (
	own: Record<string, string[]> | undefined,
	en: Record<string, string[]>,
): Record<string, string[]> =>
	Object.fromEntries(
		[...new Set([...Object.keys(en), ...Object.keys(own ?? {})])].map(
			(domain) => [domain, mergedWithEn(own?.[domain] ?? [], en[domain] ?? [])],
		),
	)

const CLOCK_WORD_KEYS: (keyof ClockWordsType)[] = [
	"am",
	"earlyMorning",
	"pm",
	"night",
	"oclock",
	"prefixes",
	"halfBefore",
	"quarterBefore",
	"minusBefore",
	"halfAfter",
	"quarterAfter",
	"minusAfter",
]

const mergedClockWords = (
	own: ClockWordsType | undefined,
	en: ClockWordsType | undefined,
): ClockWordsType =>
	Object.fromEntries(
		CLOCK_WORD_KEYS.map((key) => [
			key,
			mergedWithEn(own?.[key] ?? [], en?.[key] ?? []),
		]),
	) as ClockWordsType

const wordBoundaryRe = (words: string[]): RegExp =>
	new RegExp(`\\b(${words.map(escapeRegex).join("|")})\\b`, "i")

const articlePrefixReOf = (articles: string[]): RegExp =>
	new RegExp(
		`^(?:${[...articles]
			.sort((a, b) => b.length - a.length)
			.map(escapeRegex)
			.join("|")}) `,
	)

export const languageSetsFor = (
	language?: string | null,
): ResolvedLanguageSetsType => {
	const code = normalizeLanguage(language)
	const cached = resolvedCache.get(code)
	if (cached) return cached
	const catalog = CATALOGS.get(code) ?? EN
	const contributed = extensionsFor(code)
	const resolved: ResolvedLanguageSetsType = {
		displayName: catalog.displayName,
		locale: catalog.locale,
		latinScript: catalog.latinScript,
		spokenTime: catalog.spokenTime,
		articlePrefixRe: articlePrefixReOf(catalog.articles),
		stopwords: new Set(catalog.stopwords),
		genericWords: new Set(contributed.flatMap((ext) => ext.genericWords ?? [])),
		numberWords: { ...EN.numberWords, ...catalog.numberWords },
		numberJoiners: mergedWithEn(catalog.numberJoiners, EN.numberJoiners),
		percentWords: mergedWithEn(catalog.percentWords, EN.percentWords),
		skipWords: mergedWithEn(catalog.skipWords ?? [], EN.skipWords ?? []),
		durationUnits: {
			...(EN.durationUnits ?? {}),
			...(catalog.durationUnits ?? {}),
		},
		durationPhrases: {
			...(EN.durationPhrases ?? {}),
			...(catalog.durationPhrases ?? {}),
		},
		unitArticles: mergedWithEn(
			catalog.unitArticles ?? [],
			EN.unitArticles ?? [],
		),
		clockWords: mergedClockWords(catalog.clockWords, EN.clockWords),
		clockTwelveAm: catalog.clockTwelveAm ?? EN.clockTwelveAm ?? "midnight",
		spokenDate:
			catalog.spokenDate ?? EN.spokenDate ?? ((d) => d.toDateString()),
		memoryCommandRe: wordBoundaryRe(
			mergedWithEn(catalog.memoryCommandKeywords, EN.memoryCommandKeywords),
		),
		questionStarters: new Set(catalog.questionStarters),
		requestModals: new Set(catalog.requestModals),
		conjunctions: [...catalog.conjunctions],
		additiveCues: mergedWithEn(catalog.additiveCues, EN.additiveCues),
		allCues: mergedWithEn(catalog.allCues ?? [], EN.allCues ?? []),
		domainWords: mergedDomainWords(catalog.domainWords, EN.domainWords ?? {}),
		unitWords: catalog.unitWords,
		affirmations: new Set(catalog.affirmations),
		negations: new Set(catalog.negations),
		fastPathBlockers: mergedWithEn(
			catalog.fastPathBlockers,
			EN.fastPathBlockers,
		),
		routingBlockers: mergedWithEn(catalog.routingBlockers, EN.routingBlockers),
		personalQuestionMarkers: mergedWithEn(
			catalog.personalQuestionMarkers,
			EN.personalQuestionMarkers,
		),
		stateQuestionMarkers: mergedWithEn(
			catalog.stateQuestionMarkers,
			EN.stateQuestionMarkers,
		),
		stateQuestionOpeners: mergedWithEn(
			catalog.stateQuestionOpeners ?? [],
			EN.stateQuestionOpeners ?? [],
		),
		stateWords: mergedWithEn(catalog.stateWords ?? [], EN.stateWords ?? []),
		retryCues: mergedWithEn(catalog.retryCues, EN.retryCues),
		relationFamilyCues: Object.fromEntries(
			RELATION_FAMILIES.map((family) => [
				family,
				mergedWithEn(
					catalog.relationFamilyCues?.[family] ?? [],
					EN.relationFamilyCues?.[family] ?? [],
				),
			]),
		) as Record<RelationFamilyType, string[]>,
		selfDescriptionCues: mergedWithEn(
			catalog.selfDescriptionCues ?? [],
			EN.selfDescriptionCues ?? [],
		),
		pastTenseCues: mergedWithEn(
			catalog.pastTenseCues ?? [],
			EN.pastTenseCues ?? [],
		),
		negativePreferenceCues: mergedWithEn(
			catalog.negativePreferenceCues ?? [],
			EN.negativePreferenceCues ?? [],
		),
		interruptPhrases: mergedWithEn(
			catalog.interruptPhrases,
			EN.interruptPhrases,
		),
		anaphoraRewrites: [...extensionRewrites(code), ...catalogRewrites(catalog)],
		phrases: {
			...EN.phrases,
			...catalog.phrases,
			...contributed.reduce<Record<string, string>>(
				(acc, ext) => ({ ...acc, ...(ext.phrases ?? {}) }),
				{},
			),
		},
	}
	resolvedCache.set(code, resolved)
	return resolved
}

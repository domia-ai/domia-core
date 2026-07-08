export type LanguageCatalogType = {
	stopwords: string[]
	deviceGenericWords: string[]
	numberWords: Record<string, number>
	timerKeywords: string[]
	unitWords: { hour: string; minute: string; second: string; plural: string }
	affirmations: string[]
	negations: string[]
	phrases: Record<string, string>
}

export type ResolvedLanguageSetsType = {
	stopwords: Set<string>
	deviceGenericWords: Set<string>
	numberWords: Record<string, number>
	timerKeywordsRe: RegExp
	unitWords: { hour: string; minute: string; second: string; plural: string }
	affirmations: Set<string>
	negations: Set<string>
	phrases: Record<string, string>
}

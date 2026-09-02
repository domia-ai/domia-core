export type LanguageCatalogType = {
	stopwords: string[]
	deviceGenericWords: string[]
	numberWords: Record<string, number>
	numberJoiners: string[]
	percentWords: string[]
	timerKeywords: string[]
	memoryCommandKeywords: string[]
	unitWords: { hour: string; minute: string; second: string; plural: string }
	affirmations: string[]
	negations: string[]
	fastPathBlockers: string[]
	routingBlockers: string[]
	anaphoraRewrites: { pattern: string; template: string }[]
	phrases: Record<string, string>
}

export type ResolvedLanguageSetsType = {
	stopwords: Set<string>
	deviceGenericWords: Set<string>
	numberWords: Record<string, number>
	numberJoiners: string[]
	percentWords: string[]
	timerKeywordsRe: RegExp
	memoryCommandRe: RegExp
	unitWords: { hour: string; minute: string; second: string; plural: string }
	affirmations: Set<string>
	negations: Set<string>
	fastPathBlockers: string[]
	routingBlockers: string[]
	anaphoraRewrites: { re: RegExp; template: string }[]
	phrases: Record<string, string>
}

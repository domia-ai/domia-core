export type SpokenTimeRendererType = (date: Date) => string

export type LanguageCatalogType = {
	displayName: string
	locale: string
	latinScript: boolean
	spokenTime: SpokenTimeRendererType
	articles: string[]
	stopwords: string[]
	numberWords: Record<string, number>
	numberJoiners: string[]
	percentWords: string[]
	questionStarters: string[]
	requestModals: string[]
	conjunctions: string[]
	timerKeywords: string[]
	memoryCommandKeywords: string[]
	unitWords: { hour: string; minute: string; second: string; plural: string }
	affirmations: string[]
	negations: string[]
	interruptPhrases: string[]
	fastPathBlockers: string[]
	routingBlockers: string[]
	phrases: Record<string, string>
}

export type AnaphoraRewriteType = { pattern: string; template: string }

export type LanguageCatalogExtensionType = {
	genericWords?: string[]
	anaphoraRewrites?: AnaphoraRewriteType[]
	phrases?: Record<string, string>
}

export type ResolvedLanguageSetsType = {
	displayName: string
	locale: string
	latinScript: boolean
	spokenTime: SpokenTimeRendererType
	articlePrefixRe: RegExp
	stopwords: Set<string>
	genericWords: Set<string>
	numberWords: Record<string, number>
	numberJoiners: string[]
	percentWords: string[]
	questionStarters: Set<string>
	requestModals: Set<string>
	conjunctions: string[]
	timerKeywordsRe: RegExp
	memoryCommandRe: RegExp
	unitWords: { hour: string; minute: string; second: string; plural: string }
	affirmations: Set<string>
	negations: Set<string>
	fastPathBlockers: string[]
	routingBlockers: string[]
	interruptPhrases: string[]
	anaphoraRewrites: { re: RegExp; template: string }[]
	phrases: Record<string, string>
}

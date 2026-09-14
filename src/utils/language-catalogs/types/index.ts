import type { RelationFamilyType } from "@/modules/memory/types"

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
	additiveCues: string[]
	allCues?: string[]
	domainWords?: Record<string, string[]>
	timerKeywords: string[]
	memoryCommandKeywords: string[]
	unitWords: { hour: string; minute: string; second: string; plural: string }
	affirmations: string[]
	negations: string[]
	interruptPhrases: string[]
	fastPathBlockers: string[]
	routingBlockers: string[]
	personalQuestionMarkers: string[]
	stateQuestionMarkers: string[]
	stateQuestionOpeners?: string[]
	stateWords?: string[]
	retryCues: string[]
	relationFamilyCues?: Partial<Record<RelationFamilyType, string[]>>
	selfDescriptionCues?: string[]
	pastTenseCues?: string[]
	negativePreferenceCues?: string[]
	anaphoraRewrites?: AnaphoraRewriteType[]
	phrases: Record<string, string>
}

export type AnaphoraRewriteType = { pattern: string; template: string }

export type ScopedAnaphoraRewriteType = {
	re: RegExp
	template: string
	kind: string | null
}

export type AnaphoraLastActedType = {
	entity: string
	kind: string | null
}

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
	additiveCues: string[]
	allCues: string[]
	domainWords: Record<string, string[]>
	timerKeywordsRe: RegExp
	memoryCommandRe: RegExp
	unitWords: { hour: string; minute: string; second: string; plural: string }
	affirmations: Set<string>
	negations: Set<string>
	fastPathBlockers: string[]
	routingBlockers: string[]
	personalQuestionMarkers: string[]
	stateQuestionMarkers: string[]
	stateQuestionOpeners: string[]
	stateWords: string[]
	retryCues: string[]
	relationFamilyCues: Record<RelationFamilyType, string[]>
	selfDescriptionCues: string[]
	pastTenseCues: string[]
	negativePreferenceCues: string[]
	interruptPhrases: string[]
	anaphoraRewrites: ScopedAnaphoraRewriteType[]
	phrases: Record<string, string>
}

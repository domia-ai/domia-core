import type { SkillToolType } from "@/db"

export type ScoredToolType = {
	tool: SkillToolType
	score: number
	index: number
}

export type MatcherRankOptionsType = {
	aliases?: Record<string, string[]>
	stopwords?: Set<string>
}

export type MatcherEngineType = {
	kind: string
	rank: (
		utterance: string,
		tools: SkillToolType[],
		opts?: MatcherRankOptionsType,
	) => Promise<ScoredToolType[]> | ScoredToolType[]
}

export type MatcherConfigType = {
	engine: string
	semanticThreshold: number
	rrfK: number
	cascadeExit: number
}

export type MatcherDocType = { id: number; name: string; description: string }

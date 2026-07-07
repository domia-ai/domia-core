import { lexicalMatcherEngine } from "./lexical"
import type { MatcherEngineType } from "../types"

export const matcherEngineRegistry: Record<string, MatcherEngineType> = {
	[lexicalMatcherEngine.kind]: lexicalMatcherEngine,
}

export const getMatcherEngine = (kind: string): MatcherEngineType | null =>
	matcherEngineRegistry[kind] ?? null

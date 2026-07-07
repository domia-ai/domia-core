import MiniSearch from "minisearch"

import { languageSetsFor } from "@/utils"

import type { SkillToolType } from "@/db"

import type {
	MatcherEngineType,
	MatcherRankOptionsType,
	ScoredToolType,
	MatcherDocType,
} from "../../types"

const wordsOf = (value: string): string[] =>
	value
		.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 2)

const queryTokens = (transcript: string, stopwords: Set<string>): string[] => [
	...new Set(wordsOf(transcript).filter((w) => !stopwords.has(w))),
]

const expandAliases = (
	tokens: string[],
	aliases?: Record<string, string[]>,
): string[] => {
	if (!aliases) return tokens
	const out = new Set(tokens)
	for (const token of tokens)
		for (const alias of aliases[token] ?? []) out.add(alias)
	return [...out]
}

const SEARCH_OPTIONS = {
	boost: { name: 2 },
	prefix: true,
	fuzzy: (term: string): number | boolean => (term.length >= 5 ? 0.2 : false),
	combineWith: "OR" as const,
}

export const lexicalMatcherEngine: MatcherEngineType = {
	kind: "lexical",
	rank: (
		utterance: string,
		tools: SkillToolType[],
		opts: MatcherRankOptionsType = {},
	): ScoredToolType[] => {
		const stopwords = opts.stopwords ?? languageSetsFor().stopwords
		const index = new MiniSearch<MatcherDocType>({
			fields: ["name", "description"],
			tokenize: wordsOf,
			processTerm: (term) => (stopwords.has(term) ? null : term),
			searchOptions: SEARCH_OPTIONS,
		})
		index.addAll(
			tools.map((tool, i) => ({
				id: i,
				name: `${tool.rawName} ${tool.namespacedName}`,
				description: tool.description ?? "",
			})),
		)
		const tokens = expandAliases(
			queryTokens(utterance, stopwords),
			opts.aliases,
		)
		const scoreById = new Map<number, number>()
		if (tokens.length)
			for (const hit of index.search(tokens.join(" ")))
				scoreById.set(hit.id as number, hit.score)
		return tools
			.map((tool, i) => ({ tool, index: i, score: scoreById.get(i) ?? 0 }))
			.sort((a, b) => b.score - a.score || a.index - b.index)
	},
}

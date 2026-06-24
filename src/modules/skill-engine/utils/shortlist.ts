import type { SkillToolType } from "@/db"

import type { ToolShortlistResultType } from "../types"

const STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"please",
	"can",
	"could",
	"would",
	"you",
	"my",
	"me",
	"i",
	"to",
	"of",
	"is",
	"it",
	"do",
	"and",
])

const wordsOf = (value: string): string[] =>
	value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 2)

const queryTokens = (transcript: string): string[] => [
	...new Set(wordsOf(transcript).filter((w) => !STOPWORDS.has(w))),
]

const scoreTool = (tool: SkillToolType, tokens: string[]): number => {
	const nameWords = new Set([
		...wordsOf(tool.rawName),
		...wordsOf(tool.namespacedName),
	])
	const descWords = new Set(wordsOf(tool.description ?? ""))
	let score = 0
	for (const token of tokens) {
		if (nameWords.has(token)) score += 2
		else if (descWords.has(token)) score += 1
	}
	return score
}

export const shortlistTools = (
	transcript: string,
	tools: SkillToolType[],
	max: number,
): ToolShortlistResultType => {
	if (max <= 0 || tools.length <= max) {
		return { tools, total: tools.length, dropped: 0, applied: false }
	}
	const tokens = queryTokens(transcript)
	const scored = tools.map((tool, index) => ({
		tool,
		index,
		score: scoreTool(tool, tokens),
	}))
	const maxScore = scored.reduce((m, s) => Math.max(m, s.score), 0)
	if (maxScore === 0) {
		return { tools, total: tools.length, dropped: 0, applied: false }
	}
	const ranked = scored
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, max)
		.map((s) => s.tool)
	return {
		tools: ranked,
		total: tools.length,
		dropped: tools.length - ranked.length,
		applied: true,
	}
}

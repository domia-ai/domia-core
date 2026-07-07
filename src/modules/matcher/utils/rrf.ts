import type { SkillToolType } from "@/db"

import type { ScoredToolType } from "../types"

export const rrfFuse = (
	tools: SkillToolType[],
	lists: ScoredToolType[][],
	k: number,
): ScoredToolType[] => {
	const contribution = new Map<number, number>()
	for (const list of lists) {
		let rank = 0
		for (const item of list) {
			if (item.score <= 0) continue
			rank++
			contribution.set(
				item.index,
				(contribution.get(item.index) ?? 0) + 1 / (k + rank),
			)
		}
	}
	return tools
		.map((tool, index) => ({
			tool,
			index,
			score: contribution.get(index) ?? 0,
		}))
		.sort((a, b) => b.score - a.score || a.index - b.index)
}
